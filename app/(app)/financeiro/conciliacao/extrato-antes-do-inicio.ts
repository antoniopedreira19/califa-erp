/**
 * O Extrato antes de a conta começar no sistema, com o ajuste de abertura
 * (pedido do Tiago em 16/11/2026; revê as decisões 211 e 091).
 *
 * Só para a conta cujo saldo inicial veio do extrato do banco
 * (`contas_bancarias.saldo_inicial_do_banco`, as oito do recomeço de 03/11).
 * Nela o Extrato é um só, com saldo contínuo: antes do início, as linhas do
 * histórico da planilha que contam no saldo (cargas `periodo` e `cauda`, e a
 * previsão já ligada ao banco) e as baixas do sistema com data anterior; na
 * véspera do início, a linha "Ajuste de abertura", que leva o saldo exatamente
 * ao saldo inicial do banco.
 *
 * O ajuste é CALCULADO pela função `extrato_antes_do_inicio`, nunca gravado:
 * saldo inicial − (histórico + baixas antes do início). Quando um lançamento
 * que falta entra no histórico, ou uma baixa antiga entra no sistema, ele
 * diminui sozinho; o saldo a partir do início não muda. Fora do DRE.
 */
import type { createClient } from "@/lib/supabase/server";
import type { LinhaSemSaldo } from "@/lib/data/lancamento-linha";
import { ORIGEM_DA_CAUDA } from "./cauda-no-extrato";

type Supabase = ReturnType<typeof createClient>;

/** As linhas da planilha que o Extrato mostra de uma vez (o maior mês tem ~2.300). */
export const LIMITE_ANTES_DO_INICIO = 4000;

/** A origem da linha do ajuste de abertura no Extrato. */
export const ORIGEM_DO_AJUSTE = "ajuste_de_abertura";

/** O prefixo do id das linhas do histórico antes do início (as da cauda depois do início usam `historico:`). */
const PREFIXO = "historico-antes:";

export interface ExtratoAntesDoInicio {
  /** O dia em que a conta começa no sistema (o do saldo inicial). */
  corte: string;
  /** A véspera do início: o dia da linha do ajuste. */
  vespera: string;
  saldoInicial: number;
  /** O saldo do histórico e das baixas do sistema no fim da véspera, sem o ajuste. */
  historicoNaVespera: number;
  /** saldo inicial − histórico na véspera. */
  ajuste: number;
  /** O pedaço do período escolhido antes do início; nulo quando nenhum. */
  periodo: { de: string; ate: string } | null;
  /** O saldo contínuo antes do período (histórico + baixas, sem o ajuste). */
  saldoAnterior: number;
  /** Créditos e débitos das linhas da planilha do pedaço (todas, mesmo além do limite). */
  creditos: number;
  debitos: number;
  total: number;
  linhas: LinhaSemSaldo[];
  /** As baixas do sistema do pedaço que uma linha do histórico já registra. */
  ligados: string[];
}

type LinhaDaFuncao = {
  id: string;
  data: string;
  valor: number | string;
  carga: "periodo" | "cauda" | "previsao";
  classe: string | null;
  descricao: string | null;
  fornecedor: string | null;
  job: string | null;
  tipo_codigo: string | null;
  tipo_nome: string | null;
  subtipo_nome: string | null;
  competencia_trimestre: number | null;
  competencia_ano: number | null;
  empresa: string | null;
  regional: string | null;
  todas: boolean;
  pp_codigo: string | null;
};

type RespostaDaFuncao = {
  corte: string;
  vespera: string;
  saldo_inicial: number | string;
  historico_na_vespera: number | string;
  ajuste: number | string;
  periodo: { de: string; ate: string } | null;
  saldo_anterior?: number | string;
  creditos?: number | string;
  debitos?: number | string;
  total?: number;
  linhas?: LinhaDaFuncao[];
  ligados?: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** O trecho antes do início, ou `null` para a conta sem saldo do banco (e quando a leitura falha). */
export async function carregarExtratoAntesDoInicio(
  supabase: Supabase,
  args: { contaId: string; dataDe: string; dataAte: string },
): Promise<ExtratoAntesDoInicio | null> {
  const { data, error } = await supabase.rpc("extrato_antes_do_inicio", {
    p_conta_bancaria_id: args.contaId,
    p_de: args.dataDe,
    p_ate: args.dataAte,
    p_limite: LIMITE_ANTES_DO_INICIO,
  });
  if (error) {
    console.error("[conciliacao.antes_do_inicio]", error.message);
    return null;
  }
  if (!data) return null;
  const r = data as RespostaDaFuncao;
  return {
    corte: r.corte,
    vespera: r.vespera,
    saldoInicial: r2(Number(r.saldo_inicial)),
    historicoNaVespera: r2(Number(r.historico_na_vespera)),
    ajuste: r2(Number(r.ajuste)),
    periodo: r.periodo,
    saldoAnterior: r2(Number(r.saldo_anterior ?? 0)),
    creditos: r2(Number(r.creditos ?? 0)),
    debitos: r2(Number(r.debitos ?? 0)),
    total: r.total ?? 0,
    linhas: (r.linhas ?? []).map(paraLinhaDoExtrato),
    ligados: r.ligados ?? [],
  };
}

/** Uma linha da planilha na grade do Extrato: só leitura, como a cauda. */
function paraLinhaDoExtrato(l: LinhaDaFuncao): LinhaSemSaldo {
  const valor = Number(l.valor);
  const texto = [l.descricao, l.job, l.pp_codigo].filter(Boolean).join(" · ");
  const transferencia = l.classe === "transferencia";
  return {
    id: `${PREFIXO}${l.id}`,
    folha: null,
    data_movimento: l.data,
    descricao: `${l.carga === "previsao" ? "Previsão da planilha" : "Histórico da planilha"} · ${texto || "sem descrição"}`,
    natureza: valor >= 0 ? "entrada" : "saida",
    valor: Math.abs(valor),
    fornecedor_nome: l.fornecedor,
    // A competência que a planilha anotou; de outro ano, com o ano.
    tri_do_tipo:
      l.competencia_trimestre && l.competencia_ano
        ? `T${l.competencia_trimestre}${String(l.competencia_ano) === l.data.slice(0, 4) ? "" : `/${String(l.competencia_ano).slice(2)}`}`
        : null,
    job_id: null,
    job_codigo: null,
    // A transferência entre contas sai como "Fora do DRE", como no sistema.
    tipo_codigo: transferencia ? "" : (l.tipo_codigo ?? ""),
    tipo_nome: transferencia ? "Transferência entre contas" : (l.tipo_nome ?? ""),
    subtipo_codigo: "",
    subtipo_nome: l.subtipo_nome ?? "",
    empresa_nome: l.empresa,
    regional_nome: l.todas ? null : l.regional,
    origem_codigo: null,
    origem_recorrente: false,
    cartao_label: null,
    documento_label: null,
    documento_path: null,
    origem: ORIGEM_DA_CAUDA,
    estornada: false,
    rateio: [],
    origens: [],
    papel_na_fatura: null,
    fatura_cartao_id: null,
    conta_avulsa_id: null,
    pedido_compra_parcela_id: null,
    desembolso_parcela_id: null,
    juros_de_lancamento_id: null,
  };
}

/** A linha da planilha antes do início (para os totais quando o pedaço passa do limite). */
export function eDoHistoricoAntes(l: { id: string }): boolean {
  return l.id.startsWith(PREFIXO);
}

/**
 * Põe a linha do ajuste no fim da véspera do início, depois de tudo o que é
 * desse dia: o saldo dela é o saldo inicial da conta. Só quando a véspera
 * está no período e há diferença.
 */
export function comAjusteDeAbertura(
  linhas: LinhaSemSaldo[],
  antes: ExtratoAntesDoInicio,
  contaId: string,
): LinhaSemSaldo[] {
  if (!antes.periodo || antes.periodo.ate !== antes.vespera || Math.abs(antes.ajuste) < 0.005) return linhas;
  const ajuste: LinhaSemSaldo = {
    id: `ajuste-de-abertura:${contaId}`,
    folha: null,
    data_movimento: antes.vespera,
    descricao: "Ajuste de abertura · diferença a identificar",
    natureza: antes.ajuste > 0 ? "entrada" : "saida",
    valor: Math.abs(antes.ajuste),
    fornecedor_nome: null,
    tri_do_tipo: null,
    job_id: null,
    job_codigo: null,
    tipo_codigo: "",
    tipo_nome: "",
    subtipo_codigo: "",
    subtipo_nome: "",
    empresa_nome: null,
    regional_nome: null,
    origem_codigo: null,
    origem_recorrente: false,
    cartao_label: null,
    documento_label: null,
    documento_path: null,
    origem: ORIGEM_DO_AJUSTE,
    estornada: false,
    rateio: [],
    origens: [],
    papel_na_fatura: null,
    fatura_cartao_id: null,
    conta_avulsa_id: null,
    pedido_compra_parcela_id: null,
    desembolso_parcela_id: null,
    juros_de_lancamento_id: null,
  };
  const i = linhas.findIndex((l) => l.data_movimento > antes.vespera);
  const saida = [...linhas];
  saida.splice(i === -1 ? saida.length : i, 0, ajuste);
  return saida;
}
