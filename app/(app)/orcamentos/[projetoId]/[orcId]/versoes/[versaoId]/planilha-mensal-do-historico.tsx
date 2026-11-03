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
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import { comParametrosDoJob } from "@/lib/data/parametros-do-job";

export function PlanilhaMensalDoHistorico(props: React.ComponentProps<typeof PlanilhaMensal>) {
  const historico = useHistoricoDoOrcamento();
  const antiga = historico?.versao ?? null;
  // O mês que uma errata do job incluiu (decisão 219) não existia antes
  // dela: na versão que o cliente aprovou, e em cada momento anterior, ele
  // sai. Antes da errata o mês ainda não tem linha (Tiago, 29/10/2026).
  const meses = React.useMemo(() => {
    if (!antiga) return props.meses;
    const mesDoGrupo = new Map(antiga.grupos.map((g) => [g.id, g.mes_id]));
    const comLinha = new Set(antiga.itens.map((i) => mesDoGrupo.get(i.grupo_id)));
    return props.meses.filter((m) => !m.incluido_na_errata_id || comLinha.has(m.id));
  }, [antiga, props.meses]);
  // Decisão 233: os meses da versão antiga fecham com os parâmetros dela.
  const par = antiga ? (historico?.parametros ?? null) : null;
  const versao = par ? comParametrosDoJob(props.versao, par) : props.versao;
  return (
    <PlanilhaMensal
      {...props}
      versao={versao}
      planilha={par ? configDaPlanilha(props.planilha.modeloPlanilha, versao) : props.planilha}
      meses={meses}
      grupos={antiga ? antiga.grupos : props.grupos}
      itens={antiga ? antiga.itens : props.itens}
    />
  );
}
