/**
 * Códigos de DARF das guias federais (módulo fiscal, entrega 2 — 02/10/2026).
 *
 * Os mesmos do protótipo aprovado em 02/10/2026: PIS, COFINS, IRPJ e CSLL
 * mudam com o regime da PJ; as retenções feitas ao pagar fornecedores têm
 * código único. ISS (próprio e retido) é guia municipal, sem código de DARF.
 */
import type { RegimeTributarioPJ } from "@/lib/types";
import type { Tributo } from "./apuracao";

export const CODIGOS_DARF_POR_REGIME = {
  /** 6912: PIS não cumulativo · 8109: PIS cumulativo. */
  PIS: { lucro_real: "6912", lucro_presumido: "8109" },
  /** 5856: COFINS não cumulativa · 2172: COFINS cumulativa. */
  COFINS: { lucro_real: "5856", lucro_presumido: "2172" },
  /** 0220: IRPJ do lucro real trimestral · 2089: IRPJ do lucro presumido. */
  IRPJ: { lucro_real: "0220", lucro_presumido: "2089" },
  /** 6773: CSLL do lucro real trimestral · 2372: CSLL do lucro presumido. */
  CSLL: { lucro_real: "6773", lucro_presumido: "2372" },
} as const;

/** PIS, COFINS e CSLL retidos na fonte de fornecedores, numa guia só. */
export const CODIGO_DARF_CSRF = "5952";
/** IRRF retido na fonte sobre serviços de fornecedores. */
export const CODIGO_DARF_IRRF = "1708";

/** O código do DARF do tributo para o regime da PJ; nulo no ISS. */
export function codigoDarf(tributo: Tributo, regime: RegimeTributarioPJ): string | null {
  switch (tributo) {
    case "PIS":
    case "COFINS":
    case "IRPJ":
    case "CSLL":
      return CODIGOS_DARF_POR_REGIME[tributo][regime];
    case "CSRF":
      return CODIGO_DARF_CSRF;
    case "IRRF":
      return CODIGO_DARF_IRRF;
    default:
      return null;
  }
}
