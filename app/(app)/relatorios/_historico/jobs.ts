import type { VisaoDaRentabilidade } from "@/lib/historico-financeiro/rentabilidade";

/**
 * Os filtros dos relatórios dos jobs do histórico (decisão 211, A4): a
 * rentabilidade e o faturamento leem os jobs das abas Res. Jobs de uma
 * empresa num ano, no ano inteiro ou num trimestre (a coluna T), por cliente,
 * marca ou job.
 */

/** As empresas com abas Res. Jobs, com o endereço de cada uma. */
export const EMPRESAS: readonly { slug: string; empresa: string }[] = [
  { slug: "california", empresa: "Agência California" },
  { slug: "cch", empresa: "CCH" },
  { slug: "hitlab", empresa: "Hitlab" },
  { slug: "ventura", empresa: "Ventura" },
];

export const PERIODOS: readonly { slug: string; rotulo: string; trimestre: string | null }[] = [
  { slug: "ano", rotulo: "Ano", trimestre: null },
  { slug: "1", rotulo: "1º tri", trimestre: "1T" },
  { slug: "2", rotulo: "2º tri", trimestre: "2T" },
  { slug: "3", rotulo: "3º tri", trimestre: "3T" },
  { slug: "4", rotulo: "4º tri", trimestre: "4T" },
];

export const VISOES: readonly { slug: VisaoDaRentabilidade; rotulo: string }[] = [
  { slug: "cliente", rotulo: "Cliente" },
  { slug: "marca", rotulo: "Marca" },
  { slug: "job", rotulo: "Job" },
];
