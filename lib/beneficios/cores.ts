import type { BeneficioTipo } from "@/lib/types";

/**
 * Paleta oficial por tipo de benefício.
 * - saúde (SulAmerica) → azul
 * - dental (Bradesco)  → vermelho
 *
 * Centralizar aqui evita divergência entre chips, cards, ícones e KPIs.
 * Mudanças de cor passam a existir em um lugar só.
 */
export interface CoresBeneficio {
  /** Classe de cor para ícones (text-*) */
  icon: string;
  /** Classes do chip inline (bg + text + border) */
  chip: string;
  /** Classe de fundo esmaecida para blocos */
  bgSuave: string;
  /** Classe para texto principal (ex: KPI number) */
  texto: string;
}

const CORES: Record<BeneficioTipo, CoresBeneficio> = {
  // Saúde (SulAmerica) — azul (sky)
  saude: {
    icon: "text-sky-600",
    chip: "bg-sky-50 text-sky-700 border-sky-200",
    bgSuave: "bg-sky-50",
    texto: "text-sky-700",
  },
  // Dental (Bradesco) — vermelho (rose)
  dental: {
    icon: "text-rose-600",
    chip: "bg-rose-50 text-rose-700 border-rose-200",
    bgSuave: "bg-rose-50",
    texto: "text-rose-700",
  },
};

export function coresBeneficio(tipo: BeneficioTipo): CoresBeneficio {
  return CORES[tipo];
}

/**
 * Ordem canônica dos planos nos chips e listas: dental primeiro, depois
 * saúde. Dentro do mesmo tipo, ordem alfabética por nome.
 */
export function compararPlanosParaChip<
  T extends { tipo: BeneficioTipo; nome: string },
>(a: T, b: T): number {
  if (a.tipo !== b.tipo) {
    return a.tipo === "dental" ? -1 : 1;
  }
  return a.nome.localeCompare(b.nome, "pt-BR");
}
