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
 * - **NFs de fornecedor:** as PPs aprovadas ou pagas com a NF registrada
 *   pelo financeiro na aprovação (`nf_*`), com as alíquotas decididas ali
 *   (`pedidos_compra_retencoes`) e os pagamentos (`pp_baixa`) com o que a
 *   agência de fato reteve.
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

interface PPDoBanco {
  id: string;
  codigo: string;
  nf_numero: string | null;
  nf_data_emissao: string | null;
  nf_valor: number | string | null;
  nf_tomador_estabelecimento_id: string | null;
  credito_pis_cofins_retirado: boolean | null;
  credito_pis_cofins_motivo: string | null;
  fornecedor: { nome: string | null; razao_social: string | null } | null;
  job: JobDoBanco | null;
  retencoes: Array<{ imposto: string; aliquota: number | string }> | null;
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
      .from("pedidos_compra")
      .select(
        "id, codigo, nf_numero, nf_data_emissao, nf_valor, nf_tomador_estabelecimento_id, " +
          "credito_pis_cofins_retirado, credito_pis_cofins_motivo, " +
          `fornecedor:fornecedores(nome, razao_social), job:jobs(${SELECT_JOB}), ` +
          "retencoes:pedidos_compra_retencoes(imposto, aliquota)",
      )
      .eq("tenant_id", tenantId)
      .in("status", ["aprovada", "pago"])
      .not("nf_registrada_em", "is", null),
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
  const ppsBanco = ((ppsRes.data ?? []) as unknown as PPDoBanco[]).filter(
    (p) => p.nf_data_emissao && p.nf_valor !== null && p.nf_tomador_estabelecimento_id && p.job,
  );

  // Segunda rodada: os jobs das notas e os pagamentos das PPs.
  const idsDeJob = [
    ...new Set(
      notasBanco.flatMap((n) =>
        (n.itens ?? []).filter((i) => (i.origem_tipo === "job" || i.origem_tipo === "save") && i.origem_id).map((i) => i.origem_id!),
      ),
    ),
  ];
  const idsDePP = ppsBanco.map((p) => p.id);
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
    pps: ppsBanco,
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
  pps: PPDoBanco[];
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

  const notasFornecedor: NotaFornecedorFiscal[] = e.pps.map((p) => {
    const aliquotas: Partial<Record<ImpostoRetido, number>> = {};
    for (const r of p.retencoes ?? []) {
      const imposto = r.imposto as ImpostoRetido;
      const a = Number(r.aliquota);
      if (IMPOSTOS.includes(imposto) && Number.isFinite(a) && a > 0) aliquotas[imposto] = a;
    }
    return {
      id: p.id,
      pp: p.codigo,
      numero: p.nf_numero ?? "—",
      fornecedor_nome: p.fornecedor?.nome?.trim() || p.fornecedor?.razao_social?.trim() || "—",
      job: jobDoFato(p.job!),
      tomador_estabelecimento_id: p.nf_tomador_estabelecimento_id!,
      emissao: p.nf_data_emissao!,
      valor: Number(p.nf_valor),
      aliquotas_aprovacao: aliquotas,
      sem_credito: Boolean(p.credito_pis_cofins_retirado),
      motivo_sem_credito: p.credito_pis_cofins_motivo,
      pagamentos: (pagamentosPorPP.get(p.id) ?? [])
        .slice()
        .sort((a, b) => a.data_movimento.localeCompare(b.data_movimento))
        .map((pg) => {
          const retido = retidoDe(pg.retencoes);
          return {
            id: pg.id,
            data: pg.data_movimento,
            bruto: Math.round((Number(pg.valor) + somaRetida(retido)) * 100) / 100,
            retido,
          };
        }),
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
