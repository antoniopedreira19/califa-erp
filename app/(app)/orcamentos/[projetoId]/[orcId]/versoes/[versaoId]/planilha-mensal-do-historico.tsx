"use client";

/**
 * A planilha do mensal com o Histórico do orçamento (decisão 226): a versão
 * antiga escolhida entra no lugar dos agrupamentos e das linhas de hoje, e a
 * `PlanilhaMensal` reparte os meses como sempre. Arquivo à parte para não
 * fechar um ciclo de imports com `historico-do-orcamento.tsx`.
 */
import * as React from "react";
import { PlanilhaMensal } from "../../planilha-mensal";
import { useHistoricoDoOrcamento } from "./historico-do-orcamento";

export function PlanilhaMensalDoHistorico(props: React.ComponentProps<typeof PlanilhaMensal>) {
  const historico = useHistoricoDoOrcamento();
  const antiga = historico?.versao ?? null;
  return (
    <PlanilhaMensal
      {...props}
      grupos={antiga ? antiga.grupos : props.grupos}
      itens={antiga ? antiga.itens : props.itens}
    />
  );
}
