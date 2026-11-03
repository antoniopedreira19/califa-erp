/**
 * A guia do IOF do mútuo (decisão 230): uma por CNPJ que emprestou e por mês.
 *
 * Sem principal definido, a base é a soma dos saldos de cada dia, apurada no
 * último dia do mês (Decreto 6.306/2007, art. 7º, I, "a"). O adicional incide
 * sobre o que aumentou o saldo no mês (art. 7º, § 16). O recolhimento vence no
 * 3º dia útil depois do dia 10 do mês seguinte (art. 10).
 *
 * Só o regime mensal: mútuo com valor fixo em contrato tem IOF na entrega do
 * dinheiro (art. 10, VII) e fica para quando aparecer. O calculado é a
 * referência: quem manda é o valor da guia, e a diferença fica registrada.
 */

import type { FeriadoDoVencimento } from "./datas";
import { addDias, dataBr, ehDiaUtil, nomeDoMes, proximoMes, r2, ultimoDiaDoMes } from "./datas";
import type { Guia, ItemMemoria } from "./apuracao";

/** % ao dia, para pessoa jurídica. */
export const IOF_AO_DIA = 0.0082;
/** % sobre o que aumentou o saldo no mês. */
export const IOF_ADICIONAL = 0.38;
/** Tomador pessoa jurídica. A confirmar com a contabilidade. */
export const CODIGO_DO_IOF = "1150";

export interface MutuoDoIof {
  /** O CNPJ que emprestou: é ele que recolhe. */
  credor_id: string;
  credor_nome: string;
  empresa_id: string;
  empresa_nome: string;
  regional_id: string | null;
  regional_nome: string | null;
  /** A outra parte, que aparece na memória de cálculo. */
  com: string;
  /** O que saiu para a outra parte, com os juros informados (% ao mês). */
  saidas: Array<{ data: string; valor: number; juros: number | null }>;
  /** O que voltou. */
  devolucoes: Array<{ data: string; valor: number }>;
}

const dias = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000);

const fator = (juros: number | null, de: string, ate: string) => (juros ? (1 + juros / 100) ** (dias(de, ate) / 30) : 1);

/** O saldo devido no fim de um dia: as saídas, com juros, menos o que voltou. */
export function saldoDoMutuoNoDia(m: Pick<MutuoDoIof, "saidas" | "devolucoes">, dia: string): number {
  const devido = m.saidas.filter((s) => s.data <= dia).reduce((t, s) => t + s.valor * fator(s.juros, s.data, dia), 0);
  const voltou = m.devolucoes.filter((d) => d.data <= dia).reduce((t, d) => t + d.valor, 0);
  return Math.max(devido - voltou, 0);
}

function diasDaCompetencia(comp: string): string[] {
  const fim = ultimoDiaDoMes(comp);
  const out: string[] = [];
  for (let d = `${comp}-01`; d <= fim; d = addDias(d, 1)) out.push(d);
  return out;
}

/** O que aumentou o saldo no mês: as saídas e os juros que entraram nele. */
function acrescimosDoMes(m: Pick<MutuoDoIof, "saidas">, comp: string) {
  const inicio = addDias(`${comp}-01`, -1);
  const fim = ultimoDiaDoMes(comp);
  let saidas = 0;
  let juros = 0;
  for (const s of m.saidas) {
    if (s.data > fim) continue;
    if (s.data > inicio) saidas += s.valor;
    juros += s.valor * (fator(s.juros, s.data, fim) - fator(s.juros, s.data, s.data > inicio ? s.data : inicio));
  }
  return { saidas: r2(saidas), juros: r2(juros) };
}

/** 3º dia útil depois do dia 10 do mês seguinte. */
export function vencimentoDoIof(comp: string, feriados: readonly FeriadoDoVencimento[]): string {
  let d = `${proximoMes(comp)}-10`;
  for (let uteis = 0; uteis < 3; ) {
    d = addDias(d, 1);
    if (ehDiaUtil(d, feriados)) uteis += 1;
  }
  return d;
}

const pct = (v: number) => String(v).replace(".", ",");

/** As guias de uma competência. Sem saldo nem movimento no mês, não há guia. */
export function guiasDoIofDoMutuo(mutuos: readonly MutuoDoIof[], comp: string, feriados: readonly FeriadoDoVencimento[]): Guia[] {
  const out: Guia[] = [];
  for (const credor of [...new Set(mutuos.map((m) => m.credor_id))]) {
    const doCredor = mutuos.filter((m) => m.credor_id === credor);
    const partes = doCredor.map((m) => ({
      m,
      soma: r2(diasDaCompetencia(comp).reduce((s, dia) => s + saldoDoMutuoNoDia(m, dia), 0)),
      ...acrescimosDoMes(m, comp),
    }));
    const soma = r2(partes.reduce((s, p) => s + p.soma, 0));
    const acrescimos = r2(partes.reduce((s, p) => s + p.saidas + p.juros, 0));
    if (soma === 0 && acrescimos === 0) continue;

    const diario = r2((soma * IOF_AO_DIA) / 100);
    const adicional = r2((acrescimos * IOF_ADICIONAL) / 100);
    const inicioBr = dataBr(`${comp}-01`).slice(0, 5);
    const fimBr = dataBr(ultimoDiaDoMes(comp)).slice(0, 5);
    const memoria: ItemMemoria[] = [
      ...partes.map((p): ItemMemoria => {
        const juros = [...new Set(p.m.saidas.map((s) => s.juros).filter(Boolean))] as number[];
        return {
          grupo: "base",
          rotulo: `Mútuo com a ${p.m.com}`,
          detalhe: `Soma do saldo de cada dia, de ${inicioBr} a ${fimBr}${juros.length ? `, com juros de ${juros.map(pct).join(" e ")}% ao mês` : ", só o principal"}`,
          valor: p.soma,
        };
      }),
      { grupo: "base", rotulo: "(=) Soma dos saldos diários", valor: soma },
      { grupo: "debito", rotulo: "IOF diário de pessoa jurídica", base: soma, aliquota: IOF_AO_DIA, valor: diario },
      ...(adicional
        ? [{ grupo: "debito" as const, rotulo: "Adicional sobre o que aumentou o saldo no mês", base: acrescimos, aliquota: IOF_ADICIONAL, valor: adicional }]
        : []),
    ];
    const apurado = r2(diario + adicional);
    const m = doCredor[0];
    out.push({
      chave: `iof|${credor}|${comp}`,
      tributo: "IOF",
      titulo: "IOF do mútuo",
      codigo: CODIGO_DO_IOF,
      empresa_contabil_id: credor,
      estabelecimento_id: null,
      local: m.credor_nome,
      competencia: comp,
      rotulo_competencia: nomeDoMes(comp),
      periodo: "mensal",
      vencimento: vencimentoDoIof(comp, feriados),
      vencimento_motivo: null,
      regra_vencimento: "3º dia útil depois do dia 10 do mês seguinte",
      memoria,
      apurado,
      saldo_credor_gerado: 0,
      base: soma,
      rateio: [{ empresa_id: m.empresa_id, empresa_nome: m.empresa_nome, regional_id: m.regional_id, regional_nome: m.regional_nome, valor: apurado, pct: 100 }],
      avisos: [],
    });
  }
  return out;
}
