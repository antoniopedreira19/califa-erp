/**
 * Cálculo de verbas rescisórias. Centralizado aqui pra que a action de
 * criação (ao inativar) e a action de recálculo (na tela) partam da
 * mesma fonte. Snapshot gerado é persistido na tabela `rescisoes`.
 *
 * Fontes:
 * - Salário vigente → `colaboradores_salarios` (data_fim null OU >= dem)
 * - Avos de férias → RPC `fn_calcular_meses_rescisao` (soma períodos
 *   aquisitivos + mês em curso pela regra do dia 15)
 * - Avos de 13º → regra do dia 15 em TS (mês admissão só conta se
 *   admitiu ≤15; mês demissão só conta se demitiu ≥15). Doc
 *   `docs/modulos/rh/60-decimo-terceiro.md` §5.1.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type RescisaoSnapshot = {
  salario_vigente: number;
  saldo_salario_dias: number;
  saldo_salario_valor: number;
  avos_ferias: number;
  valor_ferias: number;
  valor_um_terco_ferias: number;
  avos_decimo: number;
  valor_decimo_terceiro: number;
  total_bruto: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calcularAvos13Rescisao(
  dataAdmissao: string,
  dataDemissao: string,
): number {
  const adm = new Date(dataAdmissao + "T00:00:00");
  const dem = new Date(dataDemissao + "T00:00:00");
  const anoDemissao = dem.getFullYear();

  let mesInicio: number;
  if (adm.getFullYear() < anoDemissao) {
    mesInicio = 1;
  } else if (adm.getFullYear() === anoDemissao) {
    const mesAdm = adm.getMonth() + 1;
    mesInicio = adm.getDate() <= 15 ? mesAdm : mesAdm + 1;
  } else {
    return 0;
  }

  const mesDem = dem.getMonth() + 1;
  const mesFim = dem.getDate() >= 15 ? mesDem : mesDem - 1;

  return Math.max(0, mesFim - mesInicio + 1);
}

/**
 * Monta o snapshot do cálculo da rescisão. Retorna null se faltar
 * salário vigente (colaborador sem registro em colaboradores_salarios).
 */
export async function calcularSnapshotRescisao(
  supabase: SupabaseClient,
  colaboradorId: string,
  dataAdmissao: string,
  dataDemissao: string,
): Promise<RescisaoSnapshot | null> {
  const { data: salarios } = await supabase
    .from("colaboradores_salarios")
    .select("valor")
    .eq("colaborador_id", colaboradorId)
    .lte("data_inicio", dataDemissao)
    .or(`data_fim.is.null,data_fim.gte.${dataDemissao}`)
    .order("data_inicio", { ascending: false })
    .limit(1);

  if (!salarios || salarios.length === 0) return null;
  const salario = Number(salarios[0].valor);

  const { data: avosFeriasData } = await supabase.rpc(
    "fn_calcular_meses_rescisao",
    {
      p_colaborador_id: colaboradorId,
      p_data_demissao: dataDemissao,
    },
  );
  const avosFerias = Number(avosFeriasData ?? 0);

  const dem = new Date(dataDemissao + "T00:00:00");
  const saldoDias = dem.getDate();
  const avosDecimo = calcularAvos13Rescisao(dataAdmissao, dataDemissao);

  const saldoValor = round2((salario / 30) * saldoDias);
  const valorFerias = round2((salario / 12) * avosFerias);
  const valorUmTerco = round2(valorFerias / 3);
  const valorDecimo = round2((salario / 12) * avosDecimo);
  const totalBruto = round2(saldoValor + valorFerias + valorUmTerco + valorDecimo);

  return {
    salario_vigente: salario,
    saldo_salario_dias: saldoDias,
    saldo_salario_valor: saldoValor,
    avos_ferias: avosFerias,
    valor_ferias: valorFerias,
    valor_um_terco_ferias: valorUmTerco,
    avos_decimo: avosDecimo,
    valor_decimo_terceiro: valorDecimo,
    total_bruto: totalBruto,
  };
}

export function calcularTotalLiquido(
  totalBruto: number,
  ajusteValor: number,
): number {
  return round2(totalBruto - (ajusteValor || 0));
}
