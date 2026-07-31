import type { UF } from "@/lib/types";

/** Todas as 27 UFs em ordem alfabética — usado no Select do form. */
export const UFS: UF[] = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

export function apenasDigitos(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/\D+/g, "");
}

/** 14 dígitos → 00.000.000/0000-00. Retorna vazio se input não tiver 14 dígitos. */
export function formatarCNPJ(digits: string | null | undefined): string {
  const d = apenasDigitos(digits);
  if (d.length !== 14) return digits ?? "";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** 8 dígitos → 00000-000. */
export function formatarCEP(digits: string | null | undefined): string {
  const d = apenasDigitos(digits);
  if (d.length !== 8) return digits ?? "";
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** 10 ou 11 dígitos → (DD) 0000-0000 ou (DD) 00000-0000. */
export function formatarTelefone(digits: string | null | undefined): string {
  const d = apenasDigitos(digits);
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return digits ?? "";
}
