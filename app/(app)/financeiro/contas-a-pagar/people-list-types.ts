/**
 * Tipo compartilhado entre PeopleList e RevisarFolhaDrawer.
 * Representa uma linha de folha de pagamento como o financeiro a vê:
 * com dados do colaborador, NF, status e alocações.
 */
import type { FolhaLinhaStatus, FolhaOrigem } from "@/lib/types";
import type { ColaboradorPagamento } from "@/lib/financeiro/colaboradores-pagamento";

export type FolhaLinhaFinanceiro = {
  id: string;
  competencia_ano: number;
  competencia_mes: number;
  salario_base: string;
  status: FolhaLinhaStatus;
  motivo_pendencia: string | null;
  /** Origem da linha: "california" (fluxo PJ) ou "contabilidade" (fluxo CLT). */
  origem: FolhaOrigem;
  /** NF anexada para esse (colab, escopo). Só relevante quando origem=california
   *  e tipo in (pj, mei, clt_recibo). */
  nf: {
    id: string;
    arquivo_nome: string;
    uploaded_at: string;
  } | null;
  /**
   * O colaborador inteiro como o financeiro enxerga (decisão 132): nome,
   * contratação, documentos e pagamento. Obrigatório de propósito — um
   * campo a menos aqui sumiria em silêncio da tela (CLAUDE.md).
   */
  colaborador: ColaboradorPagamento;
  alocacoes: {
    id: string;
    empresa_id: string;
    regional_id: string;
    percentual: string;
    empresa_nome: string;
    regional_nome: string;
  }[];
};
