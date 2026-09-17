import {
  blocosDoItem,
  bvContaNoRealizado,
  realizadoVemDasPPs,
} from "@/lib/calculos/bv-planilha";
import { bvSituacaoLabel, ppStatusLabel } from "@/lib/types";
import type { BvSituacao, ItemPlanilhaJob, PPStatus, TipoCusto } from "@/lib/types";
import type {
  GrupoInterno,
  ItemInterno,
  SublinhaRealizado,
} from "./planilha-interna";
import { montarFechamentoInterno } from "./montar-interna";
import type { ParametrosInternacionais } from "@/lib/calculos/versao-totais";

/**
 * A planilha do JOB vira a aba interna (decisão 088): o orçado do job (a
 * cópia, com as erratas), o planejado e o REALIZADO com as sublinhas de
 * cada PP, de cada devolução de verba e de cada BV que já conta.
 *
 * As contas não são reescritas aqui: quem diz quanto vale cada bloco é
 * `blocosDoItem`, a mesma função da tela e do card de Totais. O que este
 * módulo faz é traduzir isso para as linhas da planilha — e é por isso
 * que a soma das sublinhas fecha exatamente com o TT do item.
 *
 * O realizado exportado é o **líquido**, com o BV como sublinha negativa:
 * é a vista padrão da tela desde 27/08/2026 e foi o que o Tiago aprovou
 * (P5 e A2).
 */

/** Uma PP do item, como a sublinha precisa dela. */
export interface PPDaSublinha {
  id: string;
  codigo: string;
  status: PPStatus;
  valor: number;
  valor_unitario: number;
  quantidade: number;
  dias_meses: number;
  /** Nome do fornecedor (ou do responsável, na verba de produção). */
  pagoA: string | null;
  /** Saldo devolvido na prestação de contas da verba (decisão 081). */
  valorDevolvido: number;
}

/** Um BV do item. */
export interface BvDaSublinha {
  id: string;
  valor: number;
  situacao: BvSituacao;
  fornecedorNome: string | null;
}

export interface ItemDoJob extends ItemPlanilhaJob {
  /** `total_realizado` da linha de realizado — já sem a verba devolvida. */
  somaDasPPs: number;
  pps: PPDaSublinha[];
  bvs: BvDaSublinha[];
  /** R$ · QT · D/M do realizado, como a tela os mostra. */
  quebraDoRealizado: {
    valorUnitario: number;
    quantidade: number;
    diasMeses: number;
  };
}

export interface GrupoDoJob {
  id: string;
  nome: string;
  mesId?: string | null;
  itens: ItemDoJob[];
}

/** Uma linha da planilha do job, com as sublinhas do realizado. */
export function itemInternoDoJob(item: ItemDoJob, jobAberto: boolean): ItemInterno {
  const blocos = blocosDoItem(item, item.bvs, item.somaDasPPs, jobAberto);
  const daPP = realizadoVemDasPPs(item.tipo_custo);

  const sublinhas: SublinhaRealizado[] = [];
  for (const pp of item.pps) {
    // O valor da PP é R$ × QT × D/M desde 01/09/2026; quando bater, a
    // sublinha leva a quebra e a fórmula, como a linha do item.
    const produto = pp.valor_unitario * pp.quantidade * pp.dias_meses;
    sublinhas.push({
      rotulo: [pp.codigo, ppStatusLabel(pp.status), pp.pagoA]
        .filter(Boolean)
        .join(" · "),
      valor: pp.valor,
      marca: `pp:${pp.id}`,
      unitario:
        Math.abs(produto - pp.valor) < 0.005
          ? {
              valor: pp.valor_unitario,
              quantidade: pp.quantidade,
              diasMeses: pp.dias_meses,
            }
          : null,
    });
    if (pp.valorDevolvido > 0) {
      sublinhas.push({
        rotulo: `(−) Verba devolvida · ${pp.codigo}`,
        valor: -pp.valorDevolvido,
        marca: `devolucao:${pp.id}`,
      });
    }
  }
  for (const bv of item.bvs) {
    if (!bvContaNoRealizado(bv.situacao)) continue;
    sublinhas.push({
      rotulo: `(−) BV ${bvSituacaoLabel(bv.situacao).toLowerCase()}${
        bv.fornecedorNome ? ` · ${bv.fornecedorNome}` : ""
      }`,
      valor: -bv.valor,
      marca: `bv:${bv.id}`,
    });
  }

  return {
    id: item.id,
    item: item.item,
    tipo_custo: item.tipo_custo,
    valor_unitario_orcado: item.valor_unitario_orcado,
    quantidade_orcada: item.quantidade_orcada,
    dias_meses_orcado: item.dias_meses_orcado,
    total_orcado: item.total_orcado,
    em_save: item.em_save,
    save_consumido: item.save_consumido,
    valor_unitario_planejado: item.valor_unitario_planejado,
    quantidade_planejada: item.quantidade_planejada,
    dias_meses_planejado: item.dias_meses_planejado,
    total_planejado: item.total_planejado,
    linha_vermelha: item.linha_vermelha,
    realizado: {
      // Em `A` e `D` com o job aberto a quebra espelha o orçado, como na
      // tela; nos demais ela descreve as PPs emitidas.
      valorUnitario: daPP || !jobAberto
        ? item.quebraDoRealizado.valorUnitario
        : item.valor_unitario_orcado,
      quantidade: daPP || !jobAberto
        ? item.quebraDoRealizado.quantidade
        : item.quantidade_orcada,
      diasMeses: daPP || !jobAberto
        ? item.quebraDoRealizado.diasMeses
        : item.dias_meses_orcado,
      total: blocos.realizado.liquido,
      espelhaOrcado: !daPP && jobAberto,
      sublinhas,
      bvNaoEmitido: blocos.realizado.bvPendente,
    },
  };
}

export function gruposInternosDoJob(
  grupos: GrupoDoJob[],
  jobAberto: boolean,
): GrupoInterno[] {
  return grupos.map((g) => ({
    id: g.id,
    nome: g.nome,
    itens: g.itens.map((i) => itemInternoDoJob(i, jobAberto)),
  }));
}

/** O fechamento do job: o realizado de cada item entra líquido de BV, que
 *  é o mesmo número do card de Totais da tela. */
export function fechamentoInternoDoJob(
  itens: ItemDoJob[],
  percentualHonorarios: number,
  percentualImposto: number,
  opcoes: {
    internacional?: ParametrosInternacionais | null;
    jobAberto: boolean;
  },
) {
  return montarFechamentoInterno(
    itens.map((i) => ({
      tipo_custo: i.tipo_custo as TipoCusto,
      total_orcado: i.total_orcado,
      em_save: i.em_save,
      save_consumido: i.save_consumido,
      total_planejado: i.total_planejado,
      total_realizado: blocosDoItem(i, i.bvs, i.somaDasPPs, opcoes.jobAberto)
        .realizado.liquido,
    })),
    percentualHonorarios,
    percentualImposto,
    { internacional: opcoes.internacional, comRealizado: true },
  );
}
