/**
 * Datas do módulo fiscal: competência, dia útil e vencimento de imposto
 * (módulo fiscal, entrega 1 — 02/10/2026).
 *
 * Tudo em texto ISO ("AAAA-MM-DD") e em UTC, para não depender do fuso do
 * servidor nem do navegador. Os feriados vêm do cadastro (`fiscal_feriados`):
 * os nacionais (município nulo) valem para todos; os locais, só para o
 * município do vencimento.
 *
 * Regra de dia não útil (pesquisa de 01/10/2026, aprovada pelo Tiago):
 * - federais (PIS/COFINS dia 25, retenções dia 20) ANTECIPAM;
 * - ISS (Salvador, São Paulo, Fortaleza, Santo André) PRORROGA;
 * - IRPJ/CSLL vencem no último dia útil do mês.
 */

export type RegraDoVencimento = "antecipa" | "prorroga" | "ultimo_util";

export interface FeriadoDoVencimento {
  data: string;
  nome: string;
  /** Nulo = nacional. */
  municipio: string | null;
}

export const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

function iso(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function dt(s: string) {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDias(s: string, n: number) {
  const d = dt(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** "2026-11-04" → "2026-11". */
export const mesDe = (s: string) => s.slice(0, 7);

export function proximoMes(competencia: string) {
  const [y, m] = competencia.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function ultimoDiaDoMes(competencia: string) {
  const [y, m] = competencia.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m, 0)));
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-11" → "novembro/2026". */
export function nomeDoMes(competencia: string) {
  const [y, m] = competencia.split("-").map(Number);
  return `${MESES[m - 1]}/${y}`;
}

/** "2026-11-04" → "04/11/2026". */
export function dataBr(s: string | null | undefined) {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

export function feriadoEm(s: string, feriados: readonly FeriadoDoVencimento[], municipio?: string | null): string | null {
  const f = feriados.find((x) => x.data === s && (x.municipio === null || (municipio != null && x.municipio === municipio)));
  return f ? f.nome : null;
}

export function ehDiaUtil(s: string, feriados: readonly FeriadoDoVencimento[], municipio?: string | null) {
  const w = dt(s).getUTCDay();
  return w !== 0 && w !== 6 && !feriadoEm(s, feriados, municipio);
}

export interface Vencimento {
  data: string;
  /** Por que a data mudou ("05/12/2026 é sábado · prorroga"), ou nulo. */
  motivo: string | null;
}

/** Ajusta uma data pela regra do tributo, com o motivo para a tela explicar. */
export function ajustarVencimento(
  s: string,
  regra: RegraDoVencimento,
  feriados: readonly FeriadoDoVencimento[],
  municipio?: string | null,
): Vencimento {
  if (regra === "ultimo_util") {
    let d = s;
    while (!ehDiaUtil(d, feriados, municipio)) d = addDias(d, -1);
    return { data: d, motivo: d === s ? null : "último dia útil do mês" };
  }
  if (ehDiaUtil(s, feriados, municipio)) return { data: s, motivo: null };
  const passo = regra === "antecipa" ? -1 : 1;
  let d = s;
  while (!ehDiaUtil(d, feriados, municipio)) d = addDias(d, passo);
  const nomeDoFeriado = feriadoEm(s, feriados, municipio);
  const causa = nomeDoFeriado ? `feriado (${nomeDoFeriado})` : SEMANA[dt(s).getUTCDay()];
  return { data: d, motivo: `${dataBr(s)} é ${causa} · ${regra === "antecipa" ? "antecipa" : "prorroga"}` };
}

/** Vencimento no `dia` do mês seguinte à competência, ajustado pela regra. */
export function vencimentoNoMesSeguinte(
  competencia: string,
  dia: number,
  regra: RegraDoVencimento,
  feriados: readonly FeriadoDoVencimento[],
  municipio?: string | null,
): Vencimento {
  const prox = proximoMes(competencia);
  const ultimo = Number(ultimoDiaDoMes(prox).slice(8, 10));
  const base = `${prox}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
  return ajustarVencimento(base, regra, feriados, municipio);
}
