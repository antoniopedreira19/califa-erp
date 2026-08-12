// Formato que a visão agregada do projeto monta no servidor e entrega pronto
// pros cards. Os valores já vêm calculados: nem o card do job nem o card de
// Totais refazem conta, só formatam.

import type { JobStatus, TipoCusto } from "@/lib/types";

export interface ItemPlanilhaProjeto {
  id: string;
  nome: string;
  tipo: TipoCusto;
  categoria: string | null;
  orcUnit: number;
  orcQt: number;
  orcDm: number;
  orcTotal: number;
  planUnit: number;
  planQt: number;
  planDm: number;
  planTotal: number;
  realUnit: number;
  realQt: number;
  realDm: number;
  realTotal: number;
}

export interface GrupoPlanilhaProjeto {
  id: string;
  nome: string;
  itens: ItemPlanilhaProjeto[];
  orcado: number;
  planejado: number;
  realizado: number;
}

export interface JobPlanilhaProjeto {
  id: string;
  codigo: string;
  nome: string;
  status: JobStatus;
  responsavel: string | null;
  moeda: string;
  percentualHonorarios: number;
  percentualImposto: number;
  grupos: GrupoPlanilhaProjeto[];
  /** Soma dos totais orçados dos itens (= "Total dos custos" do job). */
  orcado: number;
  planejado: number;
  realizado: number;
  subtotaisPorTipo: Record<TipoCusto, number>;
  honorarios: number;
  imposto: number;
  /** O que a California emite nota neste job. */
  faturamentoPrevisto: number;
  /** Compromisso total do cliente. É o "valor" do job na árvore. */
  valorJob: number;
}
