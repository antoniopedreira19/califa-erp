import type { TipoContratacao } from "@/lib/types";

/**
 * Rótulo humano pros tipos de contratação exibidos em UI.
 * - `clt_recibo` vira "Híbrido" (CLT + recibo RPA — nome interno não é claro
 *   pro usuário, "Híbrido" descreve bem o modelo).
 */
export function formatarTipoContratacao(t: TipoContratacao): string {
  switch (t) {
    case "pj":
      return "PJ";
    case "mei":
      return "MEI";
    case "clt":
      return "CLT";
    case "clt_recibo":
      return "Híbrido";
    case "estagio":
      return "Estágio";
    case "socio":
      return "Sócio";
  }
}
