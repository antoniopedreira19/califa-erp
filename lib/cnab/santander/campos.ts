/**
 * Helpers de formatação de campos CNAB 240.
 *
 * Regra do manual (seção "Alinhamento dos Campos", pág. 3):
 *   • Campos numéricos formatados: à direita, zeros à esquerda.
 *   • Campos alfanuméricos: à esquerda, brancos (espaços) à direita.
 *
 * ASCII/ANSI apenas. Acento vira letra base (NFD + strip combining marks).
 * Todo campo tem comprimento fixo — passar valor maior que o tamanho é bug
 * do gerador; passar menor é normal (padding).
 */

/** Sanitiza texto pra ASCII: remove acento, mantém letras/números/espaços/pontuação básica.
 *  Não usa toUpperCase — cabe ao chamador decidir case. */
export function sanitizeAscii(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // acentos combinantes (bloco Unicode)
    .replace(/[^\x20-\x7E]/g, ""); // fora ASCII imprimível
}

/** Alfanumérico: sanitiza acento, corta em `len` chars, alinha à esquerda com espaços. */
export function padAlpha(value: string | null | undefined, len: number): string {
  const clean = sanitizeAscii(value);
  const cut = clean.slice(0, len);
  return cut.padEnd(len, " ");
}

/** Numérico: aceita string ou number, extrai só dígitos, alinha à direita com zeros.
 *  Passar valor com mais dígitos que `len` lança erro — dado inválido. */
export function padNumeric(
  value: string | number | null | undefined,
  len: number,
): string {
  const digits =
    value === null || value === undefined
      ? ""
      : String(value).replace(/\D/g, "");
  if (digits.length > len) {
    throw new Error(
      `padNumeric: valor "${digits}" tem ${digits.length} dígitos, cabe só ${len}.`,
    );
  }
  return digits.padStart(len, "0");
}

/** Espaços em branco de comprimento fixo — usado em fillers e campos "brancos". */
export function brancos(len: number): string {
  return " ".repeat(len);
}

/** Zeros de comprimento fixo — usado em fillers numéricos e campos obrigatórios em zero. */
export function zeros(len: number): string {
  return "0".repeat(len);
}

/** Data e hora de um instante no relógio de Brasília. O servidor roda em
 *  UTC: sem isto, um arquivo gerado depois das 21h sairia com a data do
 *  dia seguinte no header (e a hora 3h adiantada). */
function partesEmBrasilia(d: Date): Record<"dia" | "mes" | "ano" | "h" | "m" | "s", string> {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const v = (t: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === t)?.value ?? "00";
  return {
    dia: v("day"),
    mes: v("month"),
    ano: v("year"),
    h: v("hour"),
    m: v("minute"),
    s: v("second"),
  };
}

/** Data DDMMAAAA a partir de string ISO YYYY-MM-DD ou Date.
 *  String é data de calendário e passa como está; Date é um instante e
 *  vira a data de Brasília. Null/undefined vira zeros — o manual aceita 0
 *  em datas opcionais. */
export function formatDate(
  input: string | Date | null | undefined,
): string {
  if (!input) return "00000000";
  if (input instanceof Date) {
    const p = partesEmBrasilia(input);
    return `${p.dia}${p.mes}${p.ano}`;
  }
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error(`formatDate: entrada inválida "${input}"`);
  const [, yyyy, mm, dd] = match;
  return `${dd}${mm}${yyyy}`;
}

/** Hora HHMMSS de um instante, no relógio de Brasília. */
export function formatTime(d: Date): string {
  const p = partesEmBrasilia(d);
  return `${p.h}${p.m}${p.s}`;
}

/** Valor monetário em formato V2 (2 casas decimais implícitas, sem separador).
 *  Ex.: 4.00 → "000000000000400" (15 dígitos = 13V2). Passa como número, string
 *  BRL ("R$ 4,00") ou "4.00". Aceita numeric-string do Supabase. */
export function formatMoneyV2(
  value: string | number | null | undefined,
  len: number,
): string {
  if (value === null || value === undefined || value === "") {
    return zeros(len);
  }
  const n =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/[^0-9.,-]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`formatMoneyV2: valor inválido "${value}"`);
  }
  const cents = Math.round(n * 100);
  return padNumeric(cents, len);
}

/** Verifica que uma linha tem exatamente 240 bytes. Usado em asserção interna
 *  do gerador — nunca deve falhar em produção. */
export function assert240(linha: string, contexto: string): string {
  if (linha.length !== 240) {
    throw new Error(
      `Linha CNAB fora do tamanho: ${contexto} tem ${linha.length} bytes (esperado 240).\n[${linha}]`,
    );
  }
  return linha;
}
