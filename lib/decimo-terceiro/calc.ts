// Lógica pura de cálculo do 13º salário.
//
// Avos seguem a regra do dia 15: admissão até dia 15 conta o mês inteiro,
// admissão a partir do dia 16 não conta.
//
// INSS e IRRF 2026: tabelas progressivas aplicadas sobre o 13º bruto
// INTEGRAL (salario/12 * avos), não sobre a 2ª parcela isolada. É a regra
// legal; a planilha Excel atual aplica errado (sobre a 2ª parcela) e tem
// a fórmula de INSS quebrada com #REF!. Divergência consciente — ver
// docs/superpowers/specs/2026-10-21-decimo-terceiro-parte-1-design.md.
//
// Só CLT (clt e clt_recibo sem valorRecibo) sofre desconto. PJ, MEI e a
// parte PJ do híbrido CLT_recibo retornam 0.
//
// Híbrido CLT_recibo: quando valorRecibo > 0, o cálculo divide o 13º em
// duas partes — parte CLT (salario - valorRecibo, com descontos) e
// parte PJ (valorRecibo, sem descontos). O adiantamento é rateado entre
// as duas partes proporcionalmente ao salário.

import type { TipoContratacao } from "@/lib/types";

const round2 = (n: number) => Math.round(n * 100) / 100;

// --- Avos -------------------------------------------------------------------

export function calcularAvos(dataAdmissao: Date, ano: number): number {
  const inicioAno = new Date(Date.UTC(ano, 0, 1));
  const fimAno = new Date(Date.UTC(ano, 11, 31));

  if (dataAdmissao.getTime() > fimAno.getTime()) return 0;
  if (dataAdmissao.getTime() <= inicioAno.getTime()) return 12;

  const dia = dataAdmissao.getUTCDate();
  const mes = dataAdmissao.getUTCMonth() + 1; // 1..12

  if (dia <= 15) {
    return 13 - mes;
  }
  return 12 - mes;
}

// --- INSS 2026 --------------------------------------------------------------

const INSS_2026 = [
  { teto: 1518.0, aliquota: 0.075, deducao: 0 },
  { teto: 2793.88, aliquota: 0.09, deducao: 22.77 },
  { teto: 4190.83, aliquota: 0.12, deducao: 106.59 },
  { teto: 8157.41, aliquota: 0.14, deducao: 190.4 },
];

const INSS_TETO = 8157.41;
const INSS_TETO_VALOR = round2(INSS_TETO * 0.14 - 190.4);

export function calcularInss2026(base: number): number {
  if (base <= 0) return 0;
  if (base > INSS_TETO) return INSS_TETO_VALOR;
  for (const faixa of INSS_2026) {
    if (base <= faixa.teto) {
      return round2(base * faixa.aliquota - faixa.deducao);
    }
  }
  return INSS_TETO_VALOR;
}

// --- IRRF 2026 --------------------------------------------------------------

const IRRF_2026 = [
  { teto: 1518.0, aliquota: 0, deducao: 0 },
  { teto: 2793.88, aliquota: 0.075, deducao: 169.44 },
  { teto: 4190.83, aliquota: 0.15, deducao: 381.44 },
  { teto: 8157.41, aliquota: 0.225, deducao: 662.77 },
  { teto: Infinity, aliquota: 0.275, deducao: 896 },
];

export function calcularIrrf2026(base: number, inssDescontado: number): number {
  const baseAjustada = base - inssDescontado;
  if (baseAjustada <= 0) return 0;
  for (const faixa of IRRF_2026) {
    if (baseAjustada <= faixa.teto) {
      return Math.max(0, round2(baseAjustada * faixa.aliquota - faixa.deducao));
    }
  }
  return 0;
}

// --- Cálculo de uma parte (CLT ou PJ) ---------------------------------------

interface ParteInput {
  salario: number;
  avos: number;
  totalAdiantado: number;
  comDescontos: boolean; // true = CLT (aplica INSS + IRRF); false = PJ
}

interface ParteOutput {
  primeiraParcela: number;
  segundaParcela: number;
  descontoInss: number;
  descontoIrrf: number;
  totalBruto: number;
  totalLiquido: number;
}

function calcularParte(input: ParteInput): ParteOutput {
  const baseIntegral = round2((input.salario / 12) * input.avos);
  const metade = round2(baseIntegral / 2);
  const primeiraParcela = round2(Math.max(0, metade - input.totalAdiantado));
  const segundaParcela = metade;

  const descontoInss =
    input.comDescontos && input.avos > 0 ? calcularInss2026(baseIntegral) : 0;
  const descontoIrrf =
    input.comDescontos && input.avos > 0
      ? calcularIrrf2026(baseIntegral, descontoInss)
      : 0;

  const totalBruto = round2(primeiraParcela + segundaParcela);
  const totalLiquido = round2(totalBruto - descontoInss - descontoIrrf);

  return {
    primeiraParcela,
    segundaParcela,
    descontoInss,
    descontoIrrf,
    totalBruto,
    totalLiquido,
  };
}

// --- Orquestração: linha completa -------------------------------------------

export interface CalcInput {
  salario: number;
  dataAdmissao: Date;
  ano: number;
  tipoContratacao: TipoContratacao;
  totalAdiantado: number;
  salarioEditado?: number | null;
  avosEditado?: number | null;
  /** Parte PJ do salário quando CLT_recibo híbrido (= valor_recibo).
   *  Null/0 ou undefined cai no caminho CLT puro (sem breakdown). */
  valorRecibo?: number | null;
}

export interface ParteBreakdown {
  primeiraParcela: number;
  segundaParcela: number;
  descontoInss: number;
  descontoIrrf: number;
  totalLiquido: number;
}

export interface CalcOutput {
  avos: number;
  primeiraParcela: number;
  segundaParcela: number;
  descontoInss: number;
  descontoIrrf: number;
  totalBruto: number;
  totalLiquido: number;
  /** Breakdown da parte CLT quando CLT_recibo híbrido. Null caso contrário. */
  parteClt: ParteBreakdown | null;
  /** Breakdown da parte PJ quando CLT_recibo híbrido. Null caso contrário. */
  partePj: ParteBreakdown | null;
}

export function calcularLinhaDecimoTerceiro(input: CalcInput): CalcOutput {
  const avos =
    input.avosEditado != null
      ? input.avosEditado
      : calcularAvos(input.dataAdmissao, input.ano);

  const salario =
    input.salarioEditado != null ? input.salarioEditado : input.salario;

  const ehClt =
    input.tipoContratacao === "clt" || input.tipoContratacao === "clt_recibo";
  const valorRecibo = input.valorRecibo ?? 0;
  const ehHibrido =
    input.tipoContratacao === "clt_recibo" && valorRecibo > 0 && valorRecibo < salario;

  if (ehHibrido) {
    const salarioClt = salario - valorRecibo;
    const salarioPj = valorRecibo;

    // Adiantamento rateado proporcional ao salário de cada parte
    const adiantamentoClt = round2(
      (input.totalAdiantado * salarioClt) / salario,
    );
    const adiantamentoPj = round2(input.totalAdiantado - adiantamentoClt);

    const clt = calcularParte({
      salario: salarioClt,
      avos,
      totalAdiantado: adiantamentoClt,
      comDescontos: true,
    });
    const pj = calcularParte({
      salario: salarioPj,
      avos,
      totalAdiantado: adiantamentoPj,
      comDescontos: false,
    });

    return {
      avos,
      primeiraParcela: round2(clt.primeiraParcela + pj.primeiraParcela),
      segundaParcela: round2(clt.segundaParcela + pj.segundaParcela),
      descontoInss: clt.descontoInss,
      descontoIrrf: clt.descontoIrrf,
      totalBruto: round2(clt.totalBruto + pj.totalBruto),
      totalLiquido: round2(clt.totalLiquido + pj.totalLiquido),
      parteClt: {
        primeiraParcela: clt.primeiraParcela,
        segundaParcela: clt.segundaParcela,
        descontoInss: clt.descontoInss,
        descontoIrrf: clt.descontoIrrf,
        totalLiquido: clt.totalLiquido,
      },
      partePj: {
        primeiraParcela: pj.primeiraParcela,
        segundaParcela: pj.segundaParcela,
        descontoInss: 0,
        descontoIrrf: 0,
        totalLiquido: pj.totalLiquido,
      },
    };
  }

  // Caminho não híbrido: CLT puro, PJ puro, MEI, ou clt_recibo sem valorRecibo
  const parte = calcularParte({
    salario,
    avos,
    totalAdiantado: input.totalAdiantado,
    comDescontos: ehClt,
  });

  return {
    avos,
    primeiraParcela: parte.primeiraParcela,
    segundaParcela: parte.segundaParcela,
    descontoInss: parte.descontoInss,
    descontoIrrf: parte.descontoIrrf,
    totalBruto: parte.totalBruto,
    totalLiquido: parte.totalLiquido,
    parteClt: null,
    partePj: null,
  };
}
