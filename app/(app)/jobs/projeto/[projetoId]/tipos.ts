// Formato que a visão agregada do projeto monta no servidor e entrega pronto
// pros cards. Os valores já vêm calculados: nem o card do job nem o card de
// Totais refazem conta, só formatam.

import type { JobStatus, TipoCusto } from "@/lib/types";
import type { ValoresDoBloco } from "@/lib/calculos/bv-planilha";
import type { EstadoSaveDaLinha } from "@/app/(app)/_planilha/save-coluna";

export interface ItemPlanilhaProjeto {
  id: string;
  nome: string;
  tipo: TipoCusto;
  categoria: string | null;
  orcUnit: number;
  orcQt: number;
  orcDm: number;
  orcTotal: number;
  /** O orçado que serve de BASE À RENTABILIDADE — zero na linha em save,
   *  igual a `orcTotal` no resto (decisão 028 §9). */
  orcRentabilidade: number;
  planUnit: number;
  planQt: number;
  planDm: number;
  realUnit: number;
  realQt: number;
  realDm: number;
  /** Total do PLANEJADO com a dedução de BV separada — a vista Bruto usa
   *  `bruto`, a Líquido usa `liquido`, e a sub-linha mostra `deducaoBv`. */
  planejado: ValoresDoBloco;
  /** Idem para o REALIZADO. Em item `A` e `D` o bruto é o ORÇADO: eles
   *  não geram PP, então não há soma de PPs de onde tirá-lo. */
  realizado: ValoresDoBloco;
  /** Estado da coluna Save desta linha. A visão agregada mostra o mesmo
   *  que as planilhas internas — em leitura, sem abrir o diálogo.
   *
   *  Opcional porque o carregador só devolve as linhas que TÊM save, e
   *  ele roda no servidor: o `SAVE_VAZIO` mora num módulo `"use client"`,
   *  então quem completa o vazio é a tela, que é client. */
  save?: EstadoSaveDaLinha;
}

export interface GrupoPlanilhaProjeto {
  id: string;
  nome: string;
  itens: ItemPlanilhaProjeto[];
  orcado: number;
  /** Base da rentabilidade do grupo — sem as linhas em save. */
  orcadoRentabilidade: number;
  planejado: ValoresDoBloco;
  realizado: ValoresDoBloco;
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
  /** Base da rentabilidade do job — sem as linhas em save. */
  orcadoRentabilidade: number;
  planejado: ValoresDoBloco;
  realizado: ValoresDoBloco;
  subtotaisPorTipo: Record<TipoCusto, number>;
  honorarios: number;
  imposto: number;
  /** O que a California emite nota neste job. */
  faturamentoPrevisto: number;
  /** Compromisso total do cliente. É o "valor" do job na árvore. */
  valorJob: number;
  /** `true` quando alguma linha deste job tem relação com save. É o que
   *  decide se a coluna nasce aberta na tela do projeto. */
  temSave: boolean;
}
