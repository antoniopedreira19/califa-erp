/**
 * Os meios da Mídia Off e o que a planilha sugere em cada um (decisão 147).
 *
 * A lista é a do protótipo aprovado em 06/10/2026: os nove meios das
 * planilhas de referência dos PMs, cada um com a forma de compra. TV e
 * rádio entram em grade de inserções; OOH, DOOH e portais, por período.
 *
 * Constante de código, e não cadastro: a forma de compra decide a estrutura
 * da planilha (calendário ou início e fim), e um meio novo com a forma
 * errada quebraria o que já foi lançado. Meio novo entra aqui.
 */

import type { FormaDeCompraMidia } from "@/lib/types";

export const MEIOS: ReadonlyArray<{ nome: string; forma: FormaDeCompraMidia }> = [
  { nome: "TV Aberta", forma: "grade" },
  { nome: "TV Fechada", forma: "grade" },
  { nome: "Rádio", forma: "grade" },
  { nome: "OOH · Outdoor", forma: "periodo" },
  { nome: "OOH · Painel de LED", forma: "periodo" },
  { nome: "OOH · Busdoor / Backbus", forma: "periodo" },
  { nome: "DOOH · Aeroporto", forma: "periodo" },
  { nome: "DOOH · Elevadores", forma: "periodo" },
  { nome: "Digital · Portais", forma: "periodo" },
];

export function formaDoMeio(meio: string): FormaDeCompraMidia | null {
  return MEIOS.find((m) => m.nome === meio)?.forma ?? null;
}

/** A frase que explica como o meio entra na planilha. */
export function fraseDaForma(meio: string): string {
  const forma = formaDoMeio(meio);
  if (!forma) return "TV e rádio entram em grade de inserções; OOH, DOOH e portais, por período.";
  return forma === "grade"
    ? "Entra em grade de inserções: o calendário do mês, mês a mês."
    : "Entra por período: início e fim, quantidade e número de períodos.";
}

/** Os formatos comuns de cada meio — o campo continua livre: os PMs têm de
 *  "Filme 30"" a frases inteiras nos portais. */
export function sugestoesDoMeio(meio: string): string[] {
  if (meio.startsWith("TV"))
    return ['Filme 15"', 'Filme 30"', 'Filme 45"', 'Filme 60"', 'Merchan 15"', 'Merchan 30"', 'Merchan 45"', 'Merchan 60"'];
  if (meio === "Rádio") return ['Spot 15"', 'Spot 30"', 'Spot 60"'];
  if (meio.startsWith("DOOH") || meio.endsWith("LED")) return ['10"', '15"', '30"'];
  if (meio === "OOH · Outdoor") return ["9 x 3 m (lona)"];
  if (meio.includes("Busdoor")) return ["Backbus 2,90 x 2,40 m", "Busdoor 2,10 x 1,00 m"];
  if (meio.startsWith("Digital")) return ["Branded content", "Banner IAB", "Native"];
  return [];
}

/** Sem acento, minúsculas, espaços simples: "Filme  30"" = "filme 30"". É
 *  assim que dois formatos "iguais" se reconhecem — meio + formato
 *  identificam o meio na versão. */
export function normalizarFormato(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** O texto de exemplo do formato, pelo meio. */
export function exemploDeFormato(meio: string): string {
  if (meio.startsWith("TV")) return 'Filme 30"';
  if (meio === "Rádio") return 'Spot 30"';
  if (meio.startsWith("DOOH") || meio.endsWith("LED")) return 'Vinheta 15"';
  if (meio === "OOH · Outdoor") return "9m x 3m (lona)";
  if (meio.includes("Busdoor")) return "2,90 m x 2,40m";
  if (meio.startsWith("Digital")) return "Branded content";
  return 'Filme 30"';
}
