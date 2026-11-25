import type { SupabaseClient } from "@supabase/supabase-js";
import { irpjCsllAApurar, type BlocoAApurar, type IrpjCsllAApurar } from "@/lib/fiscal/a-apurar";
import { carregarRegrasDoRateio, type RegrasDoRateioDoTenant } from "@/lib/fiscal/rateio-gerencial-dados";
import { carregarBlocosAApurar } from "@/lib/fiscal/a-apurar-dados";
import { carregarFatosFiscais } from "@/lib/fiscal/apuracao-fatos";
import {
  PRIMEIRA_COMPETENCIA,
  calcularApuracao,
  estadoDaGuia,
  issARecuperar,
  type ARecuperar,
  type EstadoGuia,
  type Guia,
} from "@/lib/fiscal/apuracao";
import { formatarCnpj, regimeDaPJ, type CadastroFiscal } from "@/lib/fiscal/cadastro";
import type { FiscalFeriado, FiscalParametro, RegimeTributarioPJ } from "@/lib/types";

/**
 * A aba Apuração da seção Fiscal (módulo fiscal, entrega 2 — protótipo
 * aprovado pelo Tiago em 02/10/2026): as guias de cada competência,
 * calculadas hoje (fuso de São Paulo) sobre os fatos do banco
 * (`carregarFatosFiscais`) com as aprovações já feitas, e o estado de cada
 * uma (em curso, a aprovar, aprovada, diferença).
 *
 * A apuração não se grava: o que se grava é a aprovação (`./actions.ts`).
 */

/** Uma aprovação já feita, do jeito que a memória de cálculo mostra. */
export interface AprovacaoDaTela {
  id: string;
  data: string;
  valor_calculado: number;
  valor_guia: number;
  justificativa: string | null;
  diferenca: boolean;
  /** O nome do arquivo da guia anexada (o caminho fica no servidor). */
  guia_nome: string | null;
  autor: string;
  /** Decisão 277: o saldo credor que a contabilidade levou para o mês seguinte (nulo = o calculado). */
  saldo_credor_contabil: number | null;
  /** Decisão 277 §9: o ajuste da base do lucro real aprovado com esta guia (nulo = sem ajuste). */
  ajuste_base: number | null;
  ajuste_base_motivo: string | null;
}

export interface GuiaDaTela extends Guia {
  estado: EstadoGuia;
  /** Na diferença: quanto o cálculo de hoje se afastou do aprovado. */
  delta: number;
  aprovacoes: AprovacaoDaTela[];
}

export interface EstabelecimentoDaTela {
  id: string;
  empresa_contabil_id: string;
  nome: string;
  cnpj: string;
  municipio: string;
  uf: string;
  papel: "matriz" | "filial";
}

export interface PJDaTela {
  id: string;
  nome: string;
  regime: RegimeTributarioPJ;
  regime_caixa: boolean;
  /** "lucro real" · "lucro presumido pelo caixa"... */
  rotulo_regime: string;
  /** Como as guias da PJ se juntam (o texto ao lado do nome no agrupamento). */
  como_apura: string | null;
  matriz_id: string | null;
  /** PJ de teste (decisão 181): a guia em curso se aprova, com confirmação. */
  de_teste: boolean;
}

export interface ARecuperarDaTela extends ARecuperar {
  nota_numero: string;
  jobs: string;
}

/**
 * A guia da contabilidade (decisão 277): lançada aprovada, com o valor da
 * contabilidade, para o que a Apuração não calcula. Mora em Impostos a Pagar
 * (`impostos_a_pagar.da_contabilidade`) e aparece no bloco do CNPJ.
 */
export interface GuiaDaContabilidade {
  id: string;
  tributo: string;
  titulo: string;
  codigo: string | null;
  empresa_contabil_id: string;
  estabelecimento_id: string | null;
  /** "2026-09" ou "2026-T3". */
  competencia: string;
  rotulo_competencia: string;
  periodo: "mensal" | "trimestral";
  /** "2026-T3": o trimestre da competência. */
  trimestre: string;
  motivo: string;
  vencimento: string;
  valor: number;
  status: "a_pagar" | "pago";
  pago_em: string | null;
  /** Entrega 3: paga fora do sistema, com o pagamento no histórico da planilha. */
  pago_no_historico: boolean;
  rateio: Array<{ empresa: string; regional: string | null; valor: number }>;
}

export interface DadosDaApuracao {
  tenantId: string;
  /** Hoje em São Paulo ("AAAA-MM-DD"). */
  hoje: string;
  guias: GuiaDaTela[];
  aRecuperar: ARecuperarDaTela[];
  /**
   * "<PJ> · a apurar no recebimento": as PJs do lucro presumido pelo caixa
   * com título a receber em aberto (sem nenhum, o bloco não aparece).
   */
  aApurar: BlocoAApurar[];
  /**
   * O IRPJ e a CSLL que as parcelas em aberto acrescentam a cada trimestre
   * (o mesmo do fluxo de caixa): as linhas "A apurar" da lista (decisão 183).
   */
  aApurarIrpjCsll: IrpjCsllAApurar[];
  /** Falha ao ler os títulos em aberto: o bloco não aparece e a aba diz por quê. */
  aApurarErro: string | null;
  /** As PJs na ordem do cadastro de impostos. */
  pjs: PJDaTela[];
  estabelecimentos: EstabelecimentoDaTela[];
  /** Notas de saída com CNPJ emissor (as que entram na apuração). */
  notasNaApuracao: number;
  /** Notas emitidas desde o início da apuração sem CNPJ emissor (ficam de fora). */
  notasSemCnpj: number;
  /** NFs de fornecedor registradas na aprovação das PPs. */
  nfsDeFornecedor: number;
  /** O que a prévia das cotas do IRPJ/CSLL precisa (vencimento e Selic estimada). */
  feriados: FiscalFeriado[];
  parametros: FiscalParametro[];
  /** Decisão 277: as empresas gerenciais e as regras do rateio por CNPJ. */
  regrasDoRateio: RegrasDoRateioDoTenant;
  /** Decisão 277: as guias da contabilidade lançadas (fora as canceladas). */
  guiasDaContabilidade: GuiaDaContabilidade[];
  /** Falha ao ler ou calcular (a aba mostra a mensagem em vez das guias). */
  erro: string | null;
}

const INICIO = `${PRIMEIRA_COMPETENCIA}-01`;

/** Hoje no fuso da casa (o servidor roda em UTC). */
export const hojeEmSaoPaulo = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const juntar = (itens: string[]) =>
  itens.length <= 1 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;

/** O nome do arquivo no fim do caminho ("<tenant>/guias/<uuid>/darf.pdf" → "darf.pdf"). */
const nomeDoArquivo = (path: string | null) => (path ? path.split("/").pop() || path : null);

function pjsDaTela(cad: CadastroFiscal, nomes: Map<string, string>, deTeste: Set<string>, hoje: string): PJDaTela[] {
  const estabs = [...cad.estabelecimentos].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
  const ids = [...new Set(estabs.map((e) => e.empresa_contabil_id))];
  return ids.map((id) => {
    const doPj = estabs.filter((e) => e.empresa_contabil_id === id);
    const matriz = doPj.find((e) => e.papel === "matriz") ?? doPj[0];
    const filiais = doPj.filter((e) => e.papel === "filial" && e.ativo).map((e) => e.municipio);
    const { regime, regime_caixa } = regimeDaPJ(cad, id, hoje);
    let rotulo = "lucro real";
    let como: string | null = null;
    if (regime === "lucro_real") {
      como = filiais.length
        ? `federais numa guia só pela matriz (${matriz?.municipio ?? "—"}), somando ${juntar(filiais)}; ISS por estabelecimento`
        : null;
    } else if (regime_caixa) {
      rotulo = "lucro presumido pelo caixa";
      como = "ISS pela emissão da nota; PIS, COFINS, IRPJ e CSLL pelo recebimento";
    } else {
      rotulo = "lucro presumido";
    }
    return {
      id,
      nome: nomes.get(id) ?? matriz?.nome.split(" · ")[0] ?? "—",
      regime,
      regime_caixa,
      rotulo_regime: rotulo,
      como_apura: como,
      matriz_id: matriz?.id ?? null,
      de_teste: deTeste.has(id),
    };
  });
}

function vazio(tenantId: string, hoje: string, erro: string | null): DadosDaApuracao {
  return {
    tenantId,
    hoje,
    guias: [],
    aRecuperar: [],
    aApurar: [],
    aApurarIrpjCsll: [],
    aApurarErro: null,
    pjs: [],
    estabelecimentos: [],
    notasNaApuracao: 0,
    notasSemCnpj: 0,
    nfsDeFornecedor: 0,
    feriados: [],
    parametros: [],
    regrasDoRateio: { empresas: [], regionalDoCnpj: {}, gerencialDoCnpj: {} },
    guiasDaContabilidade: [],
    erro,
  };
}

interface AprovacaoDoBanco {
  id: string;
  chave: string;
  data: string;
  valor_calculado: number | string;
  valor_guia: number | string;
  justificativa: string | null;
  diferenca: boolean;
  guia_path: string | null;
  aprovada_por: string;
  saldo_credor_contabil: number | string | null;
  ajuste_base: number | string | null;
  ajuste_base_motivo: string | null;
}

interface ContabilDoBanco {
  id: string;
  tributo: string;
  titulo: string;
  codigo_receita: string | null;
  empresa_contabil_id: string;
  estabelecimento_id: string | null;
  competencia: string;
  rotulo_competencia: string;
  descricao: string;
  vencimento: string;
  valor: number | string;
  status: "a_pagar" | "pago";
  pago_em: string | null;
  pago_no_historico: boolean;
  rateio: Array<{
    valor: number | string;
    empresa: { nome_fantasia: string | null; razao_social: string } | null;
    regional: { nome: string } | null;
  }> | null;
}

function guiaDaContabilidade(c: ContabilDoBanco): GuiaDaContabilidade {
  const trimestral = c.competencia.includes("-T");
  const mes = trimestral ? null : Number(c.competencia.slice(5, 7));
  return {
    id: c.id,
    tributo: c.tributo,
    titulo: c.titulo,
    codigo: c.codigo_receita,
    empresa_contabil_id: c.empresa_contabil_id,
    estabelecimento_id: c.estabelecimento_id,
    competencia: c.competencia,
    rotulo_competencia: c.rotulo_competencia,
    periodo: trimestral ? "trimestral" : "mensal",
    trimestre: trimestral ? c.competencia : `${c.competencia.slice(0, 4)}-T${Math.ceil((mes ?? 1) / 3)}`,
    motivo: c.descricao.replace(/^Guia da contabilidade:\s*/, ""),
    vencimento: c.vencimento,
    valor: Number(c.valor),
    status: c.status,
    pago_em: c.pago_em,
    pago_no_historico: c.pago_no_historico,
    rateio: (c.rateio ?? []).map((r) => ({
      empresa: r.empresa?.nome_fantasia?.trim() || r.empresa?.razao_social || "—",
      regional: r.regional?.nome ?? null,
      valor: Number(r.valor),
    })),
  };
}

export async function carregarApuracao(supabase: SupabaseClient, tenantId: string): Promise<DadosDaApuracao> {
  const hoje = hojeEmSaoPaulo();
  try {
    const [fatosDoBanco, empresasRes, aprovacoesRes, semCnpjRes, membrosRes, regrasDoRateio, contabilRes] = await Promise.all([
      carregarFatosFiscais(supabase, tenantId),
      supabase.from("empresas_contabeis").select("id, razao_social, nome_fantasia, de_teste").eq("tenant_id", tenantId),
      supabase
        .from("fiscal_aprovacoes")
        .select(
          "id, chave, data, valor_calculado, valor_guia, justificativa, diferenca, guia_path, aprovada_por, saldo_credor_contabil, ajuste_base, ajuste_base_motivo",
        )
        .eq("tenant_id", tenantId)
        .order("aprovada_em"),
      // Só a contagem: as notas de antes do módulo fiscal não dizem por qual CNPJ saíram.
      supabase
        .from("faturamentos")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "emitido")
        .is("estabelecimento_id", null)
        .gte("data_emissao", INICIO),
      // O nome de quem aprovou: a lista de membros (a RLS de `profiles` só mostra o próprio).
      supabase.rpc("membros_ativos_do_tenant", { p_tenant_id: tenantId }),
      carregarRegrasDoRateio(supabase, tenantId),
      supabase
        .from("impostos_a_pagar")
        .select(
          "id, tributo, titulo, codigo_receita, empresa_contabil_id, estabelecimento_id, competencia, rotulo_competencia, descricao, vencimento, valor, status, pago_em, pago_no_historico, " +
            "rateio:impostos_a_pagar_rateio(valor, empresa:empresas(nome_fantasia, razao_social), regional:regionais(nome))",
        )
        .eq("tenant_id", tenantId)
        .eq("da_contabilidade", true)
        .neq("status", "cancelado")
        .order("vencimento"),
    ]);
    if (contabilRes.error) throw new Error(`[fiscal.apuracao.guias_da_contabilidade] ${contabilRes.error.message}`);
    if (empresasRes.error) throw new Error(`[fiscal.apuracao.empresas] ${empresasRes.error.message}`);
    if (aprovacoesRes.error) throw new Error(`[fiscal.apuracao.aprovacoes] ${aprovacoesRes.error.message}`);

    const { cadastro, fatos, aprovacoes } = fatosDoBanco;
    const aprovacoesDoBanco = (aprovacoesRes.data ?? []) as AprovacaoDoBanco[];

    const nomes = new Map<string, string>();
    for (const m of (membrosRes.data ?? []) as Array<{ id: string; nome: string }>) nomes.set(m.id, m.nome);
    const aprovacoesPorChave = new Map<string, AprovacaoDaTela[]>();
    for (const a of aprovacoesDoBanco) {
      const lista = aprovacoesPorChave.get(a.chave) ?? [];
      lista.push({
        id: a.id,
        data: a.data,
        valor_calculado: Number(a.valor_calculado),
        valor_guia: Number(a.valor_guia),
        justificativa: a.justificativa,
        diferenca: a.diferenca,
        guia_nome: nomeDoArquivo(a.guia_path),
        autor: nomes.get(a.aprovada_por) ?? "—",
        saldo_credor_contabil: a.saldo_credor_contabil === null ? null : Number(a.saldo_credor_contabil),
        ajuste_base: a.ajuste_base === null ? null : Number(a.ajuste_base),
        ajuste_base_motivo: a.ajuste_base_motivo,
      });
      aprovacoesPorChave.set(a.chave, lista);
    }

    const guias: GuiaDaTela[] = calcularApuracao(cadastro, fatos, hoje, aprovacoes).map((g) => {
      const s = estadoDaGuia(g, hoje, aprovacoes);
      return { ...g, estado: s.estado, delta: s.delta, aprovacoes: aprovacoesPorChave.get(g.chave) ?? [] };
    });

    const notaPorId = new Map(fatos.notas.map((n) => [n.id, n]));
    const aRecuperar: ARecuperarDaTela[] = issARecuperar(cadastro, fatos, aprovacoes, hoje).map((a) => {
      const n = notaPorId.get(a.nota_id);
      return {
        ...a,
        nota_numero: n?.numero ?? "—",
        jobs: n ? juntar(n.jobs.map((j) => j.codigo)) : "",
      };
    });

    const empresas = (empresasRes.data ?? []) as Array<{
      id: string;
      razao_social: string;
      nome_fantasia: string | null;
      de_teste: boolean;
    }>;
    const nomesDasPJs = new Map(empresas.map((e) => [e.id, e.nome_fantasia?.trim() || e.razao_social]));
    const pjsDeTeste = new Set(empresas.filter((e) => e.de_teste).map((e) => e.id));

    // Depende dos fatos (quais notas da PJ do caixa ainda têm o que receber);
    // sem nenhuma, não consulta nada.
    const aApurar = await carregarBlocosAApurar(supabase, tenantId, cadastro, fatos, hoje);

    return {
      tenantId,
      hoje,
      guias,
      aRecuperar,
      aApurar: aApurar.blocos,
      aApurarIrpjCsll: irpjCsllAApurar(cadastro, fatos, aApurar.blocos, hoje),
      aApurarErro: aApurar.erro,
      pjs: pjsDaTela(cadastro, nomesDasPJs, pjsDeTeste, hoje),
      estabelecimentos: [...cadastro.estabelecimentos]
        .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome))
        .map((e) => ({
          id: e.id,
          empresa_contabil_id: e.empresa_contabil_id,
          nome: e.nome,
          cnpj: e.cnpj ? formatarCnpj(e.cnpj) : "a informar",
          municipio: e.municipio,
          uf: e.uf,
          papel: e.papel,
        })),
      notasNaApuracao: fatos.notas.length,
      notasSemCnpj: semCnpjRes.count ?? 0,
      // Só as que entram em alguma competência apurada (emitidas ou pagas a partir dela).
      nfsDeFornecedor: fatos.notasFornecedor.filter(
        (nf) => nf.emissao >= INICIO || nf.pagamentos.some((pg) => pg.data >= INICIO),
      ).length,
      feriados: cadastro.feriados,
      parametros: cadastro.parametros,
      regrasDoRateio,
      guiasDaContabilidade: ((contabilRes.data ?? []) as unknown as ContabilDoBanco[]).map(guiaDaContabilidade),
      erro: null,
    };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    console.error("[fiscal.apuracao]", mensagem);
    return vazio(tenantId, hoje, mensagem);
  }
}

/** Guias a aprovar ou com diferença (o número da aba). */
export function contarGuiasAAprovar(dados: DadosDaApuracao): number {
  return dados.guias.filter((g) => g.estado === "a_aprovar" || g.estado === "diferenca").length;
}

/**
 * O mesmo número sem montar a tela, para a aba Apuração fechada: só os fatos
 * e o motor. `null` quando o cálculo falha (a aba fica sem número).
 */
export async function contarGuiasAAprovarNoBanco(supabase: SupabaseClient, tenantId: string): Promise<number | null> {
  try {
    const hoje = hojeEmSaoPaulo();
    const { cadastro, fatos, aprovacoes } = await carregarFatosFiscais(supabase, tenantId);
    return calcularApuracao(cadastro, fatos, hoje, aprovacoes).filter((g) => {
      const { estado } = estadoDaGuia(g, hoje, aprovacoes);
      return estado === "a_aprovar" || estado === "diferenca";
    }).length;
  } catch (e) {
    console.error("[fiscal.apuracao.contagem]", e instanceof Error ? e.message : e);
    return null;
  }
}
