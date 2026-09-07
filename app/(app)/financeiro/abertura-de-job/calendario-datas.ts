/**
 * Datas e rótulos do Calendário de Jobs.
 *
 * Tudo aqui trabalha com a string `YYYY-MM-DD` das colunas `date`, e não
 * com `Date`. Dois motivos, os dois já custaram bug neste projeto:
 *
 *   * `new Date("2026-09-07")` é interpretado como MEIA-NOITE EM UTC.
 *     No fuso de São Paulo isso é 06/09 às 21h — o job aparecia no dia
 *     anterior ao que a produção informou;
 *   * comparação de string em `YYYY-MM-DD` já é cronológica (é o que
 *     torna `"2026-09-01" <= d && d <= "2026-09-30"` uma conta correta),
 *     então o intervalo "job ativo nessa data" não precisa de `Date`
 *     nenhum.
 *
 * `Date` só aparece onde é inevitável — andar no calendário (somar dias,
 * descobrir o dia da semana) —, e sempre construído com ano/mês/dia
 * explícitos, que é a forma que o JavaScript lê no fuso local.
 */

export const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export const MESES_CURTO = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

export const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export const SEMANA_LONGA = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

/** `Date` no fuso LOCAL a partir de `YYYY-MM-DD`. Nunca use `new Date(iso)`. */
export function paraData(iso: string): Date {
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

/** `YYYY-MM-DD` de um `Date`, pelos componentes locais. */
export function paraIso(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** `YYYY-MM-DD` somado de `n` dias (aceita negativo). */
export function somaDias(iso: string, n: number): string {
  const d = paraData(iso);
  d.setDate(d.getDate() + n);
  return paraIso(d);
}

/** Quantos dias de `a` até `b`. Positivo quando `b` é depois. */
export function diasEntre(a: string, b: string): number {
  return Math.round(
    (paraData(b).getTime() - paraData(a).getTime()) / 86_400_000,
  );
}

/** Dia da semana, 0 = domingo. */
export function diaDaSemana(iso: string): number {
  return paraData(iso).getDay();
}

/** "2026-09" a partir de "2026-09-07". */
export function mesDe(iso: string): string {
  return iso.slice(0, 7);
}

/** "2026-09" somado de `n` meses. */
export function somaMeses(mes: string, n: number): string {
  const [ano, m] = mes.split("-").map(Number);
  const d = new Date(ano, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "Setembro de 2026". */
export function mesPorExtenso(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} de ${ano}`;
}

/** "07/09/2026". Corte de string, sem fuso. */
export function dataBr(iso: string | null): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "—";
  return `${dia}/${mes}/${ano}`;
}

/** "07 set" — a forma curta das colunas Início e Fim. */
export function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  const [, mes, dia] = iso.slice(0, 10).split("-");
  const m = Number(mes);
  if (!dia || !m) return "—";
  return `${dia} ${MESES_CURTO[m - 1]}`;
}

/** "Segunda-feira · 07/09/2026". */
export function diaPorExtenso(iso: string): string {
  return `${SEMANA_LONGA[diaDaSemana(iso)]} · ${dataBr(iso)}`;
}

/**
 * As células da grade de um mês, incluindo as bordas que completam as
 * semanas (o fim do mês anterior e o começo do seguinte).
 *
 * Sempre múltiplo de 7, começando num domingo — é o que a grade de
 * `grid-cols-7` espera.
 */
export function celulasDoMes(mes: string): { iso: string; doMes: boolean }[] {
  const [ano, m] = mes.split("-").map(Number);
  const primeiro = new Date(ano, m - 1, 1);
  const diasNoMes = new Date(ano, m, 0).getDate();
  const offset = primeiro.getDay();
  const total = Math.ceil((offset + diasNoMes) / 7) * 7;

  const celulas: { iso: string; doMes: boolean }[] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(ano, m - 1, 1 - offset + i);
    celulas.push({ iso: paraIso(d), doMes: d.getMonth() === m - 1 });
  }
  return celulas;
}

/** Domingo e sábado da semana em que `iso` cai. */
export function semanaDe(iso: string): { inicio: string; fim: string } {
  const inicio = somaDias(iso, -diaDaSemana(iso));
  return { inicio, fim: somaDias(inicio, 6) };
}

/** "1.234,56" — o número das colunas de dinheiro, sem o "R$". */
export function numeroBr(n: number): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * "R$ 1,2 mi", "R$ 340 mil", "R$ 940" — a forma curta dos totais de
 * grupo e dos rodapés, onde o centavo não ajuda ninguém.
 *
 * O corte em mil só entra a partir de mil: abaixo disso arredondar para
 * "R$ 0 mil" esconderia o número em vez de resumi-lo.
 */
export function valorCurto(v: number): string {
  if (v >= 1_000_000) {
    const mi = Math.round(v / 100_000) / 10;
    return `R$ ${mi.toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} mi`;
  }
  if (v >= 1_000) {
    return `R$ ${Math.round(v / 1_000).toLocaleString("pt-BR")} mil`;
  }
  return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
}

/**
 * A distância até a data do evento, do ponto de vista do dia
 * selecionado: "hoje", "em 5d", "há 12d".
 */
export function distanciaLabel(dias: number): string {
  if (dias === 0) return "hoje";
  return dias > 0 ? `em ${dias}d` : `há ${-dias}d`;
}
