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

/** Data DDMMAAAA a partir de string ISO YYYY-MM-DD ou Date.
 *  Null/undefined vira zeros — o manual aceita 0 em datas opcionais. */
export function formatDate(
  input: string | Date | null | undefined,
): string {
  if (!input) return "00000000";
  const iso = typeof input === "string" ? input : input.toISOString().slice(0, 10);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error(`formatDate: entrada inválida "${iso}"`);
  const [, yyyy, mm, dd] = match;
  return `${dd}${mm}${yyyy}`;
}

/** Hora HHMMSS a partir de Date. */
export function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}${m}${s}`;
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
