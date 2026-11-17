// O pedido de desembolso como as telas o usam (decisão 264): o módulo
// Desembolsos (quem pede) e a aba Desembolsos do Contas a Pagar (o
// financeiro) leem o mesmo formato, montado em `dados.ts`.
import type { DocumentoTipo } from "@/lib/types";

export type StatusDoDesembolso = "em_avaliacao" | "aprovada" | "pago" | "rejeitada" | "cancelada";

export const ROTULO_DO_STATUS: Record<StatusDoDesembolso, string> = {
  em_avaliacao: "Em avaliação",
  aprovada: "Aprovado",
  pago: "Pago",
  rejeitada: "Rejeitado",
  cancelada: "Cancelado",
};

export interface AnexoDoDesembolso {
  id: string;
  path: string;
  nome: string;
  tamanho: number;
  mime: string;
  tipo: DocumentoTipo | null;
  numero: string | null;
  /** Na NF, a emissão; no comprovante do reembolso, a data do gasto. */
  emissao: string | null;
  /** Na NF, o valor da nota; no comprovante do reembolso, o valor do gasto. */
  valorDoDoc: number | null;
  tomadorId: string | null;
  /** A parte da NF neste pedido (null = a nota inteira). */
  parte: number | null;
  /** A nota do cadastro único, ligada no envio. */
  notaId: string | null;
  criadoEm: string;
}

export interface PedidoDeDesembolso {
  id: string;
  codigo: string;
  descricao: string;
  valor: number;
  status: StatusDoDesembolso;
  /** Reembolso a quem pediu (sem fornecedor). */
  reembolso: boolean;
  fornecedor: { id: string; nome: string; documento: string | null; regime: string | null } | null;
  empresa: { id: string; nome: string };
  regionais: Array<{ id: string; nome: string; pct: number }>;
  parcelas: Array<{
    id: string;
    numero: number;
    /** A data pedida por quem enviou. */
    vencimento: string;
    /** A data marcada pelo financeiro na aprovação. */
    dataPagamento: string | null;
    valor: number;
    pagoEm: string | null;
  }>;
  /** A data que vale hoje: a do financeiro, senão a pedida. */
  prevista: string | null;
  anexos: AnexoDoDesembolso[];
  criador: { id: string; nome: string };
  criadoEm: string;
  enviadoEm: string | null;
  reenviadoEm: string | null;
  urgente: boolean;
  justificativaUrgente: string | null;
  aprovado: { por: string | null; em: string } | null;
  /** A última rejeição. Fica no pedido reenviado, para o histórico. */
  rejeitado: { por: string | null; em: string; motivo: string } | null;
  cancelado: { por: string | null; em: string; motivo: string } | null;
  pagoEm: string | null;
  forma: string | null;
}

/** A alocação vigente de quem pede, no RH (a empresa e a regional que o pedido já traz). */
export interface AlocacaoDeQuemPede {
  empresaId: string;
  regionalId: string | null;
}

export interface EmpresaDoForm {
  id: string;
  nome: string;
}
export interface RegionalDoForm {
  id: string;
  nome: string;
  ativo: boolean;
  empresa_id: string | null;
}
export interface FornecedorDoForm {
  id: string;
  nome: string;
  cpf_cnpj: string | null;
}
/** O CNPJ que a NF já traz escolhido para a empresa e a regional (decisão 156). */
export interface TomadorPadrao {
  porRegional: Record<string, string>;
  porEmpresa: Record<string, string>;
  geral: string | null;
}
