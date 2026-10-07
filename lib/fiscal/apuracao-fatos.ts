/**
 * Os fatos da apuração lidos do banco (módulo fiscal, entrega 2 —
 * 02/10/2026): o que o motor (`lib/fiscal/apuracao.ts`) precisa para
 * calcular as guias.
 *
 * - **Notas de saída:** `faturamentos` emitidos que já guardam o CNPJ
 *   emissor e o CNAE (as notas de antes do módulo fiscal não dizem por qual
 *   CNPJ saíram e ficam de fora). Os jobs vêm de `faturamento_itens`
 *   (`job` e `save` apontam para o job); a nota avulsa e a de BV entram
 *   com a empresa gerencial da própria nota, sem regional.
 * - **Recebimentos:** as baixas de `titulos_receber` (`titulo_baixa`), com
 *   o bruto = líquido + o que o cliente reteve (`baixas_retencoes`).
 * - **NFs de fornecedor (decisão 152, 07/10/2026):** o cadastro
 *   `notas_fiscais_fornecedor`, uma linha por nota registrada pelo
 *   financeiro, que cobre ao menos uma PP aprovada ou paga. A nota conta UMA
 *   vez, pelo total, mesmo cobrindo mais de uma PP; o ISS retido sai da
 *   alíquota guardada na nota. Os pagamentos (`pp_baixa`), com o que a
 *   agência de fato reteve, vão na primeira nota de cada PP, com o código e
 *   o job da PP que pagou.
 * - **Aprovações:** `fiscal_aprovacoes`.
 *
 * Limites conhecidos (a próxima entrega trata): o estorno parcial do valor
 * de uma baixa (`*_estorno`) não reduz o bruto aqui; a nota de BV e a avulsa
 * não sabem a regional (o rateio dela cai na empresa, sem regional).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImpostoRetido } from "@/lib/types";
import { carregarCadastroFiscal, type CadastroFiscal } from "./cadastro";
import type {
  AprovacaoFiscal,
  Cota,
  FatosFiscais,
  JobDoFato,
  NotaFornecedorFiscal,
  NotaSaidaFiscal,
  RecebimentoFiscal,
} from "./apuracao";
import { PRIMEIRA_COMPETENCIA } from "./apuracao";

export interface FatosDoBanco {
  cadastro: CadastroFiscal;
  fatos: FatosFiscais;
  aprovacoes: AprovacaoFiscal[];
}

const IMPOSTOS: readonly ImpostoRetido[] = ["ISS", "PIS", "COFINS", "CSLL", "IRRF"];
/** As PPs cujas notas entram na Apuração. */
const PP_QUE_CONTA = new Set(["aprovada", "pago"]);
const INICIO = `${PRIMEIRA_COMPETENCIA}-01`;

type Nome = { nome_fantasia: string | null; razao_social: string | null } | null;
const nomeDa = (e: Nome) => e?.nome_fantasia?.trim() || e?.razao_social?.trim() || "—";

/** O dia de um instante em São Paulo ("AAAA-MM-DD"). */
function diaEmSaoPaulo(instante: string | null | undefined, reserva: string): string {
  if (!instante) return reserva;
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) return reserva;
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function retidoDe(linhas: ReadonlyArray<{ imposto: string; valor: number | string }> | null) {
  const retido: Partial<Record<ImpostoRetido, number>> = {};
  for (const l of linhas ?? []) {
    const imposto = l.imposto as ImpostoRetido;
    if (!IMPOSTOS.includes(imposto)) continue;
    const valor = Number(l.valor);
    if (!Number.isFinite(valor) || valor <= 0) continue;
    retido[imposto] = Math.round(((retido[imposto] ?? 0) + valor) * 100) / 100;
  }
  return retido;
}

const somaRetida = (r: Partial<Record<ImpostoRetido, number>>) =>
  Object.values(r).reduce((s, v) => s + (v ?? 0), 0);

// ---------------------------------------------------------------------------
// As linhas como o banco devolve
// ---------------------------------------------------------------------------

interface JobDoBanco {
  id: string;
  codigo: string;
  nome: string;
  empresa_id: string;
  regional_id: string | null;
  empresa: Nome;
  regional: { nome: string } | null;
}

interface NotaDoBanco {
  id: string;
  numero_nf: string;
  data_emissao: string;
  valor_total: number | string;
  estabelecimento_id: string;
  fiscal_cnae_id: string;
  emitido_em: string | null;
  empresa_id: string;
  descricao: string | null;
  empresa: Nome;
  itens: Array<{ origem_tipo: string; origem_id: string | null; valor: number | string }> | null;
}

interface RecebimentoDoBanco {
  id: string;
  valor: number | string;
  data_movimento: string;
  titulo: { faturamento_id: string } | null;
  retencoes: Array<{ imposto: string; valor: number | string }> | null;
}

interface NotaFornecedorDoBanco {
  id: string;
  numero: string;
  data_emissao: string;
  valor: number | string;
  tomador_estabelecimento_id: string;
  iss_retido_aliquota: number | string | null;
  credito_pis_cofins_retirado: boolean | null;
  credito_pis_cofins_motivo: string | null;
  registrada_na_pp_id: string | null;
  fornecedor: { nome: string | null; razao_social: string | null } | null;
  anexos: Array<{
    created_at: string;
    pp: { id: string; codigo: string; status: string; job: JobDoBanco | null } | null;
  }> | null;
}

interface PagamentoDoBanco {
  id: string;
  valor: number | string;
  data_movimento: string;
  pedido_compra_id: string;
  retencoes: Array<{ imposto: string; valor: number | string }> | null;
}

interface AprovacaoDoBanco {
  chave: string;
  data: string;
  valor_calculado: number | string;
  valor_guia: number | string;
  diferenca: boolean;
  compensacoes_usadas: unknown;
  cotas: unknown;
}

const SELECT_JOB =
  "id, codigo, nome, empresa_id, regional_id, empresa:empresas(nome_fantasia, razao_social), regional:regionais(nome)";

function jobDoFato(j: JobDoBanco): JobDoFato {
  return {
    job_id: j.id,
    codigo: j.codigo,
    nome: j.nome,
    empresa_id: j.empresa_id,
    empresa_nome: nomeDa(j.empresa),
    regional_id: j.regional_id,
    regional_nome: j.regional?.nome ?? null,
  };
}

// ---------------------------------------------------------------------------
// A leitura
// ---------------------------------------------------------------------------

export async function carregarFatosFiscais(supabase: SupabaseClient, tenantId: string): Promise<FatosDoBanco> {
  const [cadastro, notasRes, recebimentosRes, ppsRes, aprovacoesRes] = await Promise.all([
    carregarCadastroFiscal(supabase, tenantId),
    supabase
      .from("faturamentos")
      .select(
        "id, numero_nf, data_emissao, valor_total, estabelecimento_id, fiscal_cnae_id, emitido_em, empresa_id, descricao, " +
          "empresa:empresas(nome_fantasia, razao_social), itens:faturamento_itens(origem_tipo, origem_id, valor)",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "emitido")
      .not("estabelecimento_id", "is", null)
      .not("fiscal_cnae_id", "is", null),
    // Dois vínculos entre lançamento e título (cada um aponta o outro): o
    // embed precisa do nome da chave.
    supabase
      .from("lancamentos_financeiros")
      .select(
        "id, valor, data_movimento, titulo:titulos_receber!lancamentos_financeiros_titulo_receber_id_fkey(faturamento_id), " +
          "retencoes:baixas_retencoes(imposto, valor)",
      )
      .eq("tenant_id", tenantId)
      .eq("origem", "titulo_baixa")
      .gte("data_movimento", INICIO),
    supabase
      .from("notas_fiscais_fornecedor")
      .select(
        "id, numero, data_emissao, valor, tomador_estabelecimento_id, iss_retido_aliquota, " +
          "credito_pis_cofins_retirado, credito_pis_cofins_motivo, registrada_na_pp_id, " +
          "fornecedor:fornecedores(nome, razao_social), " +
          `anexos:pedidos_compra_anexos(created_at, pp:pedidos_compra(id, codigo, status, job:jobs(${SELECT_JOB})))`,
      )
      .eq("tenant_id", tenantId)
      .not("registrada_em", "is", null),
    supabase
      .from("fiscal_aprovacoes")
      .select("chave, data, valor_calculado, valor_guia, diferenca, compensacoes_usadas, cotas")
      .eq("tenant_id", tenantId)
      .order("aprovada_em"),
  ]);
  for (const [rotulo, r] of [
    ["faturamentos", notasRes],
    ["recebimentos", recebimentosRes],
    ["pps", ppsRes],
    ["aprovacoes", aprovacoesRes],
  ] as const) {
    if (r.error) throw new Error(`[fiscal.fatos.${rotulo}] ${r.error.message}`);
  }

  const notasBanco = (notasRes.data ?? []) as unknown as NotaDoBanco[];
  const notasFornecedorBanco = (ppsRes.data ?? []) as unknown as NotaFornecedorDoBanco[];

  // Segunda rodada: os jobs das notas e os pagamentos das PPs.
  const idsDeJob = [
    ...new Set(
      notasBanco.flatMap((n) =>
        (n.itens ?? []).filter((i) => (i.origem_tipo === "job" || i.origem_tipo === "save") && i.origem_id).map((i) => i.origem_id!),
      ),
    ),
  ];
  // As PPs aprovadas ou pagas que as notas cobrem: os pagamentos delas.
  const idsDePP = [
    ...new Set(
      notasFornecedorBanco.flatMap((n) =>
        (n.anexos ?? []).filter((a) => a.pp && PP_QUE_CONTA.has(a.pp.status) && a.pp.job).map((a) => a.pp!.id),
      ),
    ),
  ];
  const [jobsRes, pagamentosRes] = await Promise.all([
    idsDeJob.length
      ? supabase.from("jobs").select(SELECT_JOB).in("id", idsDeJob)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    idsDePP.length
      ? supabase
          .from("lancamentos_financeiros")
          .select("id, valor, data_movimento, pedido_compra_id, retencoes:baixas_retencoes(imposto, valor)")
          .eq("tenant_id", tenantId)
          .eq("origem", "pp_baixa")
          .in("pedido_compra_id", idsDePP)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);
  if (jobsRes.error) throw new Error(`[fiscal.fatos.jobs] ${jobsRes.error.message}`);
  if (pagamentosRes.error) throw new Error(`[fiscal.fatos.pagamentos] ${pagamentosRes.error.message}`);

  return montarFatos({
    cadastro,
    notas: notasBanco,
    jobs: (jobsRes.data ?? []) as unknown as JobDoBanco[],
    recebimentos: (recebimentosRes.data ?? []) as unknown as RecebimentoDoBanco[],
    notasFornecedor: notasFornecedorBanco,
    pagamentos: (pagamentosRes.data ?? []) as unknown as PagamentoDoBanco[],
    aprovacoes: (aprovacoesRes.data ?? []) as unknown as AprovacaoDoBanco[],
  });
}

/** A montagem, separada da leitura para dar para testar. */
export function montarFatos(e: {
  cadastro: CadastroFiscal;
  notas: NotaDoBanco[];
  jobs: JobDoBanco[];
  recebimentos: RecebimentoDoBanco[];
  notasFornecedor: NotaFornecedorDoBanco[];
  pagamentos: PagamentoDoBanco[];
  aprovacoes: AprovacaoDoBanco[];
}): FatosDoBanco {
  const jobPorId = new Map(e.jobs.map((j) => [j.id, j]));

  const notas: NotaSaidaFiscal[] = e.notas.map((n) => {
    const valor = Number(n.valor_total);
    const porJob = new Map<string, JobDoFato & { valor: number }>();
    for (const i of n.itens ?? []) {
      const v = Number(i.valor);
      if (!Number.isFinite(v) || v <= 0) continue;
      const j = i.origem_id && (i.origem_tipo === "job" || i.origem_tipo === "save") ? jobPorId.get(i.origem_id) : undefined;
      const fato: JobDoFato = j
        ? jobDoFato(j)
        : {
            // Nota avulsa ou de BV: a empresa gerencial da nota, sem job.
            job_id: `nota:${n.id}`,
            codigo: "Avulso",
            nome: n.descricao?.trim() || `NF ${n.numero_nf}`,
            empresa_id: n.empresa_id,
            empresa_nome: nomeDa(n.empresa),
            regional_id: null,
            regional_nome: null,
          };
      const atual = porJob.get(fato.job_id);
      if (atual) atual.valor = Math.round((atual.valor + v) * 100) / 100;
      else porJob.set(fato.job_id, { ...fato, valor: v });
    }
    const jobs = [...porJob.values()];
    if (jobs.length === 0) {
      jobs.push({
        job_id: `nota:${n.id}`,
        codigo: "Avulso",
        nome: n.descricao?.trim() || `NF ${n.numero_nf}`,
        empresa_id: n.empresa_id,
        empresa_nome: nomeDa(n.empresa),
        regional_id: null,
        regional_nome: null,
        valor,
      });
    }
    return {
      id: n.id,
      numero: n.numero_nf,
      estabelecimento_id: n.estabelecimento_id,
      cnae_id: n.fiscal_cnae_id,
      emissao: n.data_emissao,
      conhecida_em: diaEmSaoPaulo(n.emitido_em, n.data_emissao),
      valor,
      jobs,
    };
  });

  const idsDeNota = new Set(notas.map((n) => n.id));
  const recebimentos: RecebimentoFiscal[] = e.recebimentos
    .filter((r) => r.titulo && idsDeNota.has(r.titulo.faturamento_id))
    .map((r) => {
      const retido = retidoDe(r.retencoes);
      return {
        id: r.id,
        nota_id: r.titulo!.faturamento_id,
        data: r.data_movimento,
        bruto: Math.round((Number(r.valor) + somaRetida(retido)) * 100) / 100,
        retido,
      };
    });

  const pagamentosPorPP = new Map<string, PagamentoDoBanco[]>();
  for (const p of e.pagamentos) {
    const lista = pagamentosPorPP.get(p.pedido_compra_id) ?? [];
    lista.push(p);
    pagamentosPorPP.set(p.pedido_compra_id, lista);
  }

  // Decisão 152: cada nota entra uma vez. Só conta a nota que cobre ao
  // menos uma PP aprovada ou paga — a PP que a registrou pode ter sido
  // reprovada depois (decisão 083), e aí a nota espera a próxima.
  type PPDaNota = { id: string; codigo: string; job: JobDoFato; anexada_em: string };
  const notasComPPs = e.notasFornecedor
    .map((n) => {
      const pps = new Map<string, PPDaNota>();
      for (const a of n.anexos ?? []) {
        if (!a.pp || !PP_QUE_CONTA.has(a.pp.status) || !a.pp.job) continue;
        const atual = pps.get(a.pp.id);
        if (!atual || a.created_at < atual.anexada_em)
          pps.set(a.pp.id, { id: a.pp.id, codigo: a.pp.codigo, job: jobDoFato(a.pp.job), anexada_em: a.created_at });
      }
      return { n, pps: [...pps.values()].sort((x, y) => x.codigo.localeCompare(y.codigo)) };
    })
    .filter((x) => x.pps.length > 0);

  // A primeira nota de cada PP (na ordem em que foi anexada) leva os
  // pagamentos dela: as retenções do pagamento são da PP, não da nota.
  const primeiraNotaDaPP = new Map<string, { nota: string; em: string }>();
  for (const { n, pps } of notasComPPs) {
    for (const pp of pps) {
      const atual = primeiraNotaDaPP.get(pp.id);
      if (!atual || pp.anexada_em < atual.em || (pp.anexada_em === atual.em && n.id < atual.nota))
        primeiraNotaDaPP.set(pp.id, { nota: n.id, em: pp.anexada_em });
    }
  }

  const notasFornecedor: NotaFornecedorFiscal[] = notasComPPs.map(({ n, pps }) => {
    const iss = Number(n.iss_retido_aliquota);
    // O job da nota: o da PP que a registrou, se ainda conta; senão, o da primeira.
    const daQueRegistrou = pps.find((pp) => pp.id === n.registrada_na_pp_id) ?? pps[0];
    return {
      id: n.id,
      pp: pps.map((pp) => pp.codigo).join(", "),
      pp_ids: pps.map((pp) => pp.id),
      numero: n.numero,
      fornecedor_nome: n.fornecedor?.nome?.trim() || n.fornecedor?.razao_social?.trim() || "—",
      job: daQueRegistrou.job,
      tomador_estabelecimento_id: n.tomador_estabelecimento_id,
      emissao: n.data_emissao,
      valor: Number(n.valor),
      aliquotas_aprovacao: Number.isFinite(iss) && iss > 0 ? { ISS: iss } : {},
      sem_credito: Boolean(n.credito_pis_cofins_retirado),
      motivo_sem_credito: n.credito_pis_cofins_motivo,
      pagamentos: pps
        .filter((pp) => primeiraNotaDaPP.get(pp.id)?.nota === n.id)
        .flatMap((pp) =>
          (pagamentosPorPP.get(pp.id) ?? []).map((pg) => {
            const retido = retidoDe(pg.retencoes);
            return {
              id: pg.id,
              data: pg.data_movimento,
              bruto: Math.round((Number(pg.valor) + somaRetida(retido)) * 100) / 100,
              retido,
              pp: pp.codigo,
              job: pp.job,
            };
          }),
        )
        .sort((a, b) => a.data.localeCompare(b.data)),
    };
  });

  const aprovacoes: AprovacaoFiscal[] = e.aprovacoes.map((a) => ({
    chave: a.chave,
    data: a.data,
    valor_calculado: Number(a.valor_calculado),
    valor_guia: Number(a.valor_guia),
    diferenca: a.diferenca,
    compensacoes_usadas: Array.isArray(a.compensacoes_usadas) ? (a.compensacoes_usadas as string[]) : [],
    cotas: Array.isArray(a.cotas) ? (a.cotas as Cota[]) : null,
  }));

  return { cadastro: e.cadastro, fatos: { notas, recebimentos, notasFornecedor }, aprovacoes };
}
