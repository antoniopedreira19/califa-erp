/**
 * A COMPETÊNCIA de uma fatura de cartão, como a aba Cartão navega por ela
 * (decisão 093, entrega 2): o mês em que a fatura FECHA — `2026-09` para a
 * fatura que fecha em 25/09/2026 e vence em 05/10. É o que o financeiro
 * chama de "fatura de setembro", e é o que a URL carrega em
 * `?competencia=`.
 *
 * Puro: vale no servidor e no cliente.
 */

export type Competencia = { ano: number; mes: number }; // mes 1..12

const MESES_LONGOS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const MESES_CURTOS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** `"2026-09"` → `{ano: 2026, mes: 9}`; qualquer outra coisa → `null`. */
export function lerCompetencia(valor: string | null | undefined): Competencia | null {
  if (!valor) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(valor);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12 || ano < 2000 || ano > 2100) return null;
  return { ano, mes };
}

/** A competência de uma data ISO (`2026-09-25` → set/26). */
export function competenciaDaData(iso: string): Competencia {
  return { ano: Number(iso.slice(0, 4)), mes: Number(iso.slice(5, 7)) };
}

export function competenciaAtual(hoje = new Date()): Competencia {
  return { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 };
}

export function chaveCompetencia(c: Competencia): string {
  return `${c.ano}-${String(c.mes).padStart(2, "0")}`;
}

export function somarMeses(c: Competencia, n: number): Competencia {
  const total = c.ano * 12 + (c.mes - 1) + n;
  return { ano: Math.floor(total / 12), mes: (total % 12) + 1 };
}

export function mesmaCompetencia(a: Competencia, b: Competencia): boolean {
  return a.ano === b.ano && a.mes === b.mes;
}

/** "Setembro 2026" — o título entre as setas. */
export function rotuloCompetencia(c: Competencia): string {
  return `${MESES_LONGOS[c.mes - 1]} ${c.ano}`;
}

/** "set/26" — a forma curta, para a capa e o aviso da baixa. */
export function rotuloCurto(c: Competencia): string {
  return `${MESES_CURTOS[c.mes - 1]}/${String(c.ano).slice(2)}`;
}

export const MESES_CURTOS_LISTA = MESES_CURTOS;
