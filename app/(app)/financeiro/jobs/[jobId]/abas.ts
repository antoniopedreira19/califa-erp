/**
 * As abas do job no financeiro, e a leitura do `?aba=` da URL.
 *
 * Mora em módulo próprio, e não dentro de `job-financeiro-tabs.tsx`, por
 * uma razão de fronteira: aquele arquivo é `"use client"`, e o Next
 * substitui os exports de um módulo client por REFERÊNCIAS de cliente.
 * Componente atravessa essa fronteira; função comum, não — o server
 * component importaria `abaDaUrl` e receberia um objeto de referência,
 * quebrando em tempo de execução com "is not a function".
 *
 * O `tsc` não vê esse erro: os tipos batem dos dois lados. Só aparece no
 * navegador (07/09/2026).
 */

export type TabKey = "abertura" | "info" | "planilha" | "fluxo" | "chat";

/** As abas que a URL pode pedir por `?aba=`. */
export const TAB_KEYS: TabKey[] = [
  "abertura",
  "info",
  "planilha",
  "fluxo",
  "chat",
];

/** A aba pedida pela URL, ou `undefined` se veio lixo (ou nada). */
export function abaDaUrl(valor: string | undefined): TabKey | undefined {
  return TAB_KEYS.includes(valor as TabKey) ? (valor as TabKey) : undefined;
}
