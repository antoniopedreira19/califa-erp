/**
 * O histórico da planilha no Extrato da conta (decisão 211, A3).
 *
 * Antes de a conta começar no sistema (a data do saldo inicial dela), o
 * Extrato mostra o que a planilha financeira registrou, só para leitura. A
 * função `historico_extrato_da_conta` corta o período escolhido nesse pedaço
 * e devolve o saldo antes dele (a abertura da carga mais antiga mais os
 * movimentos anteriores), os créditos, os débitos e as linhas na ordem da
 * planilha; aqui o saldo de cada linha é acumulado a partir dele.
 */
import type { createClient } from "@/lib/supabase/server";

type Supabase = ReturnType<typeof createClient>;

/** As linhas que o Extrato mostra de uma vez; os totais valem para o período inteiro. */
export const LIMITE_DO_HISTORICO = 3000;

export interface LinhaDoHistorico {
  id: string;
  data: string;
  /** Com sinal: o que entra é positivo. */
  valor: number;
  credito: number;
  debito: number;
  /** O saldo depois da linha, a partir do saldo anterior do período. */
  saldo: number;
  classe: "dre" | "transferencia" | "estorno" | "sem classificação";
  descricao: string | null;
  fornecedor: string | null;
  job: string | null;
  tipoCodigo: string | null;
  tipoNome: string | null;
  subtipoNome: string | null;
  /** A competência que a planilha anotou ("1T 2026"), quando há. */
  competencia: { trimestre: number; ano: number } | null;
  empresa: string | null;
  regional: string | null;
  /** TD: de todas as regionais. */
  todas: boolean;
  tipoPlanilha: string | null;
  cod: string | null;
  aba: string;
  linha: number;
}

export interface HistoricoDoExtrato {
  /** O dia em que a conta começa no sistema (o do saldo inicial). */
  corte: string;
  /** O que o histórico carregado cobre nesta conta; nulo quando ela não tem histórico. */
  cobertura: { de: string; ate: string } | null;
  /** O pedaço do período escolhido que cai no histórico; nulo quando nenhum. */
  periodo: { de: string; ate: string } | null;
  saldoAnterior: number;
  creditos: number;
  debitos: number;
  /** As linhas do pedaço; `linhas` pode trazer menos (`LIMITE_DO_HISTORICO`). */
  total: number;
  linhas: LinhaDoHistorico[];
}

type LinhaDaFuncao = {
  id: string;
  data: string;
  valor: number | string;
  classe: LinhaDoHistorico["classe"];
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
  tipo_planilha: string | null;
  cod: string | null;
  aba: string;
  linha: number;
};

type RespostaDaFuncao = {
  corte: string;
  cobertura: { de: string; ate: string } | null;
  periodo: { de: string; ate: string } | null;
  saldo_anterior?: number | string;
  creditos?: number | string;
  debitos?: number | string;
  total?: number;
  linhas?: LinhaDaFuncao[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** O histórico da conta no período, ou `null` quando a leitura falha (o Extrato do sistema segue de pé). */
export async function carregarHistoricoDoExtrato(
  supabase: Supabase,
  args: { contaId: string; dataDe: string; dataAte: string },
): Promise<HistoricoDoExtrato | null> {
  const { data, error } = await supabase.rpc("historico_extrato_da_conta", {
    p_conta_bancaria_id: args.contaId,
    p_de: args.dataDe,
    p_ate: args.dataAte,
    p_limite: LIMITE_DO_HISTORICO,
  });
  if (error) {
    console.error("[conciliacao.historico]", error.message);
    return null;
  }
  if (!data) return null;
  const r = data as RespostaDaFuncao;
  const saldoAnterior = r2(Number(r.saldo_anterior ?? 0));
  let saldo = saldoAnterior;
  const linhas = (r.linhas ?? []).map((l): LinhaDoHistorico => {
    const valor = Number(l.valor);
    saldo = r2(saldo + valor);
    return {
      id: l.id,
      data: l.data,
      valor,
      credito: valor > 0 ? valor : 0,
      debito: valor < 0 ? -valor : 0,
      saldo,
      classe: l.classe,
      descricao: l.descricao,
      fornecedor: l.fornecedor,
      job: l.job,
      tipoCodigo: l.tipo_codigo,
      tipoNome: l.tipo_nome,
      subtipoNome: l.subtipo_nome,
      competencia:
        l.competencia_trimestre && l.competencia_ano ? { trimestre: l.competencia_trimestre, ano: l.competencia_ano } : null,
      empresa: l.empresa,
      regional: l.regional,
      todas: l.todas,
      tipoPlanilha: l.tipo_planilha,
      cod: l.cod,
      aba: l.aba,
      linha: l.linha,
    };
  });
  return {
    corte: r.corte,
    cobertura: r.cobertura,
    periodo: r.periodo,
    saldoAnterior,
    creditos: r2(Number(r.creditos ?? 0)),
    debitos: r2(Number(r.debitos ?? 0)),
    total: r.total ?? 0,
    linhas,
  };
}
