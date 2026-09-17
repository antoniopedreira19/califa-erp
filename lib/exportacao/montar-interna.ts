import {
  calcularTotaisVersao,
  type ItemParaTotais,
  type ParametrosInternacionais,
} from "@/lib/calculos/versao-totais";
import type { FechamentoInterno, LadoInterno } from "./planilha-interna";
import type { TipoCusto } from "@/lib/types";

/**
 * O fechamento da planilha interna (decisão 088), com a mesma conta das
 * telas — `calcularTotaisVersao`, e nada reescrito aqui.
 *
 * A planilha termina no **valor do job** (lado `job`) e, quando há save,
 * no **valor ajustado**: `valor do job + save gerado − save consumido`.
 *
 * As duas parcelas de save são a MESMA conta do valor do job, rodada só
 * sobre as linhas em save (ou sobre o quanto de cada linha é pago com
 * crédito). Os custos de transação internacional saem delas: são uma
 * constante do orçamento, e entram uma vez só, no valor do job.
 *
 * Conferido em 17/09/2026 contra o lado `cliente` do ERP — que é o
 * FATURAMENTO da planilha do cliente — em quatro cenários: JOB-0009 (save
 * gerado, internacional), crédito consumido no nacional, um misto com A,
 * AR, C, D, F e FI, e o mesmo misto no internacional com ITC. Em todos, o
 * ajustado bate centavo a centavo.
 */
export interface ItemParaFechamentoInterno extends ItemParaTotais {
  total_planejado?: number | string | null;
  /** Custo realizado do item, já líquido de BV. Só no job. */
  total_realizado?: number | null;
}

export function montarFechamentoInterno(
  itens: ItemParaFechamentoInterno[],
  percentualHonorarios: number,
  percentualImposto: number,
  opcoes: {
    internacional?: ParametrosInternacionais | null;
    comRealizado?: boolean;
  } = {},
): FechamentoInterno {
  const internacional = opcoes.internacional ?? null;
  const itc = internacional?.intTransactionCosts ?? 0;
  const totais = calcularTotaisVersao(
    itens,
    percentualHonorarios,
    percentualImposto,
    internacional ?? undefined,
  );

  const numero = (v: number | string | null | undefined) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  // A mesma conta do valor do job, só sobre as linhas em save.
  const emSave = itens
    .filter((i) => i.em_save)
    .map((i) => ({ tipo_custo: i.tipo_custo, total_orcado: numero(i.total_orcado) }));
  const consumidas = itens
    .filter((i) => !i.em_save && numero(i.save_consumido) > 0)
    .map((i) => ({
      tipo_custo: i.tipo_custo,
      total_orcado: Math.min(numero(i.save_consumido), numero(i.total_orcado)),
    }));
  const parcela = (lista: { tipo_custo: TipoCusto; total_orcado: number }[]) =>
    lista.length === 0
      ? 0
      : calcularTotaisVersao(
          lista,
          percentualHonorarios,
          percentualImposto,
          internacional ?? undefined,
        ).job.total - itc;

  const saveGerado = parcela(emSave);
  const saveConsumido = parcela(consumidas);
  const linhasEmSave = emSave.reduce((s, i) => s + i.total_orcado, 0);
  const valorDoJob = totais.job.total;

  const planejado = numero(
    itens.reduce((s, i) => s + (i.em_save ? 0 : numero(i.total_planejado)), 0),
  );
  const realizado = opcoes.comRealizado
    ? itens.reduce((s, i) => s + (i.em_save ? 0 : numero(i.total_realizado)), 0)
    : null;

  const lado = (custo: number): LadoInterno => {
    const rentabilidade = totais.orcadoParaRentabilidade - custo;
    const resultado = rentabilidade + totais.job.honorarios;
    return {
      total: custo,
      rentabilidade,
      percentualRentabilidade:
        totais.orcadoParaRentabilidade > 0
          ? (rentabilidade / totais.orcadoParaRentabilidade) * 100
          : null,
      resultadoOperacional: resultado,
      percentualResultadoGeral: valorDoJob > 0 ? (resultado / valorDoJob) * 100 : null,
    };
  };

  return {
    subtotaisPorTipo: totais.subtotaisPorTipo,
    subtotalGeral: totais.subtotalGeral,
    linhasEmSave,
    honorarios: totais.job.honorarios,
    percentualHonorarios,
    imposto: totais.job.imposto,
    percentualImposto,
    valorDoJob,
    internacional: internacional
      ? {
          fee: totais.job.honorarios,
          intTaxes: totais.job.intTaxes,
          percentualIntTaxes: internacional.percentualIntTaxes,
          recebidoExterior:
            totais.job.principal + totais.job.honorarios + totais.job.intTaxes,
          intTransactionCosts: totais.job.intTransactionCosts,
          impostoBr: totais.job.imposto,
        }
      : null,
    saveGerado,
    saveConsumido,
    valorAjustado: valorDoJob + saveGerado - saveConsumido,
    planejado: lado(planejado),
    realizado: realizado === null ? null : lado(realizado),
  };
}

/**
 * O fechamento TOTAL de um arquivo com mais de um orçamento — o resumo do
 * fim, no molde do "RESUMO DO TRIMESTRE" do mensal (pedido do Tiago,
 * 17/09/2026: "fechamentos próprios, e o total").
 *
 * Soma os fechamentos já calculados, e não os itens: cada orçamento fecha
 * com os SEUS percentuais de honorários e imposto, exatamente como a
 * planilha do cliente faz com várias seções. Percentual que não é o mesmo
 * em todos vira `null` — não há UM número a mostrar, e a linha sai sem ele.
 */
export function somarFechamentosInternos(
  fechamentos: FechamentoInterno[],
): FechamentoInterno {
  const soma = (pegar: (f: FechamentoInterno) => number) =>
    fechamentos.reduce((s, f) => s + pegar(f), 0);
  const uniforme = (pegar: (f: FechamentoInterno) => number | null) => {
    const valores = new Set(fechamentos.map(pegar));
    return valores.size === 1 ? [...valores][0] : null;
  };

  const subtotaisPorTipo = {} as FechamentoInterno["subtotaisPorTipo"];
  for (const f of fechamentos) {
    for (const [tipo, valor] of Object.entries(f.subtotaisPorTipo)) {
      const t = tipo as keyof typeof subtotaisPorTipo;
      subtotaisPorTipo[t] = (subtotaisPorTipo[t] ?? 0) + valor;
    }
  }

  const subtotalGeral = soma((f) => f.subtotalGeral);
  const linhasEmSave = soma((f) => f.linhasEmSave);
  const valorDoJob = soma((f) => f.valorDoJob);
  const honorarios = soma((f) => f.honorarios);
  const base = subtotalGeral - linhasEmSave;

  const lado = (qual: "planejado" | "realizado"): LadoInterno | null => {
    const lados = fechamentos.map((f) => f[qual] ?? null);
    if (lados.some((l) => l === null)) return null;
    const total = lados.reduce((s, l) => s + l!.total, 0);
    const rentabilidade = lados.reduce((s, l) => s + l!.rentabilidade, 0);
    const resultado = rentabilidade + honorarios;
    return {
      total,
      rentabilidade,
      percentualRentabilidade: base > 0 ? (rentabilidade / base) * 100 : null,
      resultadoOperacional: resultado,
      percentualResultadoGeral: valorDoJob > 0 ? (resultado / valorDoJob) * 100 : null,
    };
  };

  const temInternacional = fechamentos.some((f) => f.internacional);

  return {
    subtotaisPorTipo,
    subtotalGeral,
    linhasEmSave,
    honorarios,
    percentualHonorarios: uniforme((f) => f.percentualHonorarios),
    imposto: soma((f) => f.imposto),
    percentualImposto: uniforme((f) => f.percentualImposto) ?? 0,
    valorDoJob,
    internacional: temInternacional
      ? {
          fee: soma((f) => f.internacional?.fee ?? 0),
          intTaxes: soma((f) => f.internacional?.intTaxes ?? 0),
          percentualIntTaxes:
            uniforme((f) => f.internacional?.percentualIntTaxes ?? null) ?? 0,
          recebidoExterior: soma((f) => f.internacional?.recebidoExterior ?? 0),
          intTransactionCosts: soma((f) => f.internacional?.intTransactionCosts ?? 0),
          impostoBr: soma((f) => f.internacional?.impostoBr ?? 0),
        }
      : null,
    saveGerado: soma((f) => f.saveGerado),
    saveConsumido: soma((f) => f.saveConsumido),
    valorAjustado: soma((f) => f.valorAjustado),
    planejado: lado("planejado") ?? {
      total: 0,
      rentabilidade: 0,
      percentualRentabilidade: null,
      resultadoOperacional: null,
      percentualResultadoGeral: null,
    },
    realizado: lado("realizado"),
  };
}
