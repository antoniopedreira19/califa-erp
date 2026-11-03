"use client";

/**
 * O cabeçalho da versão com o Histórico do orçamento (decisão 233): com uma
 * versão antiga escolhida, a linha de parâmetros e o resumo do topo mostram
 * os dela — os parâmetros que valiam naquele momento e o valor do job, o
 * resultado e a rentabilidade das linhas dela. Sem Histórico, ou na versão
 * atual, são os mesmos componentes de sempre. Arquivo à parte para não
 * fechar um ciclo de imports com `historico-do-orcamento.tsx`.
 */
import * as React from "react";
import { MetaVersao } from "../../meta-versao";
import { ResumoRentabilidade } from "./resumo-rentabilidade";
import { useHistoricoDoOrcamento } from "./historico-do-orcamento";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import { calcularResultadoOperacional, calcularTotaisVersao } from "@/lib/calculos/versao-totais";
import type { CategoriaModeloPlanilha } from "@/lib/types";

export function MetaVersaoDoHistorico(props: React.ComponentProps<typeof MetaVersao>) {
  const par = useHistoricoDoOrcamento()?.parametros ?? null;
  if (!par) return <MetaVersao {...props} />;
  return (
    <MetaVersao
      {...props}
      percentualHonorarios={par.percentual_honorarios}
      percentualImposto={par.percentual_imposto}
      internacional={
        props.internacional
          ? {
              moedaEstrangeira: par.moeda_estrangeira ?? "",
              cambioCotacao: par.cambio_cotacao,
              cambioCompra: par.cambio_compra,
              cambioVenda: par.cambio_venda,
              cambioData: par.cambio_data,
              percentualIntTaxes: par.percentual_int_taxes,
              intTransactionCosts: par.int_transaction_costs,
            }
          : null
      }
    />
  );
}

export function ResumoDoHistorico({
  modeloPlanilha,
  ...props
}: React.ComponentProps<typeof ResumoRentabilidade> & { modeloPlanilha: CategoriaModeloPlanilha }) {
  const historico = useHistoricoDoOrcamento();
  const par = historico?.parametros ?? null;
  const antiga = historico?.versao ?? null;
  if (!par || !antiga) return <ResumoRentabilidade {...props} />;
  // A mesma conta do servidor (`VersaoSelecionada`), sobre as linhas e os
  // parâmetros da versão escolhida. A Mídia Off não tem Histórico.
  const totais = calcularTotaisVersao(
    antiga.itens,
    par.percentual_honorarios,
    par.percentual_imposto,
    configDaPlanilha(modeloPlanilha, par).internacional,
  );
  const custoPlanejado = antiga.itens.reduce((s, it) => s + Number(it.total_planejado ?? 0), 0);
  const { resultadoOperacional, resultadoGeral } = calcularResultadoOperacional(
    totais.valorJob,
    totais.deducoesDoResultado,
    custoPlanejado,
  );
  return (
    <ResumoRentabilidade
      {...props}
      valorJob={totais.valorJob}
      resultadoOperacional={resultadoOperacional}
      resultadoGeral={resultadoGeral}
    />
  );
}
