/** Datas do modelo mensal — o trimestre do orçamento e os meses dele
 *  (decisão 078).
 *
 *  Tudo em string ISO (`YYYY-MM-DD`), sem `Date`: o fuso do servidor e o do
 *  navegador não concordam sobre meia-noite, e um `new Date("2026-07-01")`
 *  vira 30 de junho em São Paulo. Um mês aqui é sempre o dia 1 dele.
 *
 *  Regras (Tiago, 14/09/2026):
 *  - o período de um orçamento Fee/Always On começa e termina no MESMO
 *    trimestre civil — que pode ser futuro, de qualquer ano;
 *  - os meses nascem dos meses que o período cobre;
 *  - apagar ou adicionar um mês faz o período acompanhar os meses,
 *    mantendo o dia digitado quando o mês da ponta continua.
 */

export interface Trimestre {
  ano: number;
  /** 1 a 4. */
  trimestre: number;
}

export interface Periodo {
  inicio: string;
  fim: string;
}

const NOMES_MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function partes(iso: string): { ano: number; mes: number; dia: number } {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { ano: a, mes: m, dia: d };
}

function doisDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

/** `true` para `YYYY-MM-DD` que existe no calendário. */
export function dataIsoValida(iso: string | null | undefined): iso is string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const { ano, mes, dia } = partes(iso);
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasNoMes(ano, mes);
}

function diasNoMes(ano: number, mes: number): number {
  if (mes === 2) {
    const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
    return bissexto ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

/** O dia 1 do mês da data. */
export function primeiroDiaDoMes(iso: string): string {
  const { ano, mes } = partes(iso);
  return `${ano}-${doisDigitos(mes)}-01`;
}

/** O último dia do mês da data. */
export function ultimoDiaDoMes(iso: string): string {
  const { ano, mes } = partes(iso);
  return `${ano}-${doisDigitos(mes)}-${doisDigitos(diasNoMes(ano, mes))}`;
}

export function trimestreDe(iso: string): Trimestre {
  const { ano, mes } = partes(iso);
  return { ano, trimestre: Math.floor((mes - 1) / 3) + 1 };
}

export function mesmoTrimestre(a: string, b: string): boolean {
  const ta = trimestreDe(a);
  const tb = trimestreDe(b);
  return ta.ano === tb.ano && ta.trimestre === tb.trimestre;
}

/** Os três meses do trimestre, em ordem. */
export function mesesDoTrimestre({ ano, trimestre }: Trimestre): string[] {
  const primeiro = (trimestre - 1) * 3 + 1;
  return [0, 1, 2].map((i) => `${ano}-${doisDigitos(primeiro + i)}-01`);
}

/** Os meses que o período cobre, em ordem. Só faz sentido para período
 *  dentro de um trimestre — quem chama confere antes com
 *  `mesmoTrimestre`. */
export function mesesDoPeriodo({ inicio, fim }: Periodo): string[] {
  const a = partes(inicio);
  const b = partes(fim);
  const meses: string[] = [];
  let ano = a.ano;
  let mes = a.mes;
  while (ano < b.ano || (ano === b.ano && mes <= b.mes)) {
    meses.push(`${ano}-${doisDigitos(mes)}-01`);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return meses;
}

/**
 * O período depois de apagar ou adicionar meses: ele passa a descrever os
 * meses da planilha. Na ponta cujo mês continua o mesmo, o dia digitado
 * fica (um início em 15/08 segue 15/08); na ponta que mudou, vale o
 * primeiro dia do primeiro mês ou o último dia do último.
 *
 * `null` quando não há mês — o orçamento mensal nunca fica sem mês, e a
 * ação que apaga recusa antes de chegar aqui.
 */
export function periodoQueAcompanhaOsMeses(
  periodo: Periodo | null,
  meses: string[],
): Periodo | null {
  if (meses.length === 0) return null;
  const ordenados = [...meses].map(primeiroDiaDoMes).sort();
  const primeiro = ordenados[0];
  const ultimo = ordenados[ordenados.length - 1];
  const inicio =
    periodo && primeiroDiaDoMes(periodo.inicio) === primeiro
      ? periodo.inicio
      : primeiro;
  const fim =
    periodo && primeiroDiaDoMes(periodo.fim) === ultimo
      ? periodo.fim
      : ultimoDiaDoMes(ultimo);
  return { inicio, fim };
}

/** "Julho de 2026". */
export function rotuloMes(iso: string): string {
  const { ano, mes } = partes(iso);
  const nome = NOMES_MESES[mes - 1];
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${ano}`;
}

/** "Julho" — para a régua, onde o ano já está no trimestre. */
export function rotuloMesCurto(iso: string): string {
  const nome = NOMES_MESES[partes(iso).mes - 1];
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)}`;
}

/** "julho" — no meio de uma frase ("Totais de julho"). */
export function nomeDoMes(iso: string): string {
  return NOMES_MESES[partes(iso).mes - 1];
}

/** "3º trimestre de 2026". */
export function rotuloTrimestre({ ano, trimestre }: Trimestre): string {
  return `${trimestre}º trimestre de ${ano}`;
}

/** "3T/2026". */
export function siglaTrimestre({ ano, trimestre }: Trimestre): string {
  return `${trimestre}T/${ano}`;
}

/**
 * Confere o período de um orçamento do modelo mensal. Devolve a mensagem
 * para o usuário, ou `null` quando está tudo certo.
 */
export function erroDoPeriodoMensal(
  inicio: string | null,
  fim: string | null,
): string | null {
  if (!dataIsoValida(inicio) || !dataIsoValida(fim)) {
    return "Informe o início e o fim previstos: os meses do orçamento nascem do período.";
  }
  if (fim < inicio) {
    return "Data fim deve ser igual ou posterior à data início.";
  }
  if (!mesmoTrimestre(inicio, fim)) {
    return "O período precisa começar e terminar no mesmo trimestre: cada orçamento de Fee ou Always On é um trimestre.";
  }
  return null;
}
