"use client";

/** A planilha da conferência do financeiro, com a chave Bruto ⇄ Líquido.
 *
 *  Client component pelo mesmo motivo de `JobRealizadoSection`: a chave
 *  vale para os grupos E para o card de Totais, então o estado tem que
 *  morar no ancestral comum dos dois.
 *
 *  Esta é a tela em que o planejado CONGELA — é aqui que o financeiro
 *  confere o que vai virar compromisso do job. Por isso ela precisava
 *  enxergar o BV: sem ele o financeiro aprovaria um custo planejado com a
 *  comissão ainda embutida, que é justamente o número que a vista Líquido
 *  existe para mostrar.
 */

import * as React from "react";
import type {
  ItemBv,
  ItemPlanilhaJob,
  JobItemRealizado,
  VersaoOrcamentoGrupo,
} from "@/lib/types";
import { VISAO_BV_PADRAO, type VisaoBv } from "@/lib/calculos/bv-planilha";
import { ChaveBrutoLiquido } from "@/app/(app)/_planilha/chave-bruto-liquido";
import {
  BotaoRecolherTodos,
  useGruposRecolhiveis,
} from "@/app/(app)/_planilha/recolher-grupos";
import { JobGrupoCard } from "@/app/(app)/jobs/[jobId]/realizado/job-grupo-card";
import { JobTotaisCard } from "@/app/(app)/jobs/[jobId]/realizado/job-totais-card";

interface Props {
  jobId: string;
  jobEmpresaId: string;
  jobResponsavelId: string;
  grupos: VersaoOrcamentoGrupo[];
  itens: ItemPlanilhaJob[];
  itensPorGrupo: Map<string, ItemPlanilhaJob[]>;
  realizadosMap: Map<string, JobItemRealizado>;
  categoriasMap: Map<string, string>;
  bvsPorItem: Record<string, ItemBv>;
  versaoLabel: string;
  moeda: string;
  percentualHonorarios: number;
  percentualImposto: number;
}

export function PlanilhaConferencia({
  jobId,
  jobEmpresaId,
  jobResponsavelId,
  grupos,
  itens,
  itensPorGrupo,
  realizadosMap,
  categoriasMap,
  bvsPorItem,
  versaoLabel,
  moeda,
  percentualHonorarios,
  percentualImposto,
}: Props) {
  const [visao, setVisao] = React.useState<VisaoBv>(VISAO_BV_PADRAO);
  const gruposIds = React.useMemo(() => grupos.map((g) => g.id), [grupos]);
  const recolher = useGruposRecolhiveis(gruposIds);

  if (grupos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
        <p className="text-sm text-muted-foreground">
          A versão aprovada não tem grupos.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-end gap-3">
        <BotaoRecolherTodos
          algumAberto={recolher.algumAberto}
          onAlternarTodos={recolher.alternarTodos}
        />
        <ChaveBrutoLiquido visao={visao} onChange={setVisao} />
      </div>

      <div className="space-y-4">
        {grupos.map((g) => (
          <JobGrupoCard
            key={g.id}
            grupo={g}
            itens={itensPorGrupo.get(g.id) ?? []}
            realizadosMap={realizadosMap}
            categoriasMap={categoriasMap}
            moeda={moeda}
            percentualImposto={percentualImposto}
            visao={visao}
            aberto={recolher.estaAberto(g.id)}
            onAlternar={() => recolher.alternar(g.id)}
            // Leitura pura: nem errata, nem BV, nem PP.
            podeAcoes={false}
            // Esta rota só existe enquanto o job aguarda abertura (já
            // aberto, ela redireciona para /jobs/[jobId]) — e nela a
            // trilha lateral não aparece de jeito nenhum.
            preAbertura
            jobId={jobId}
            // Job aguardando abertura não tem PP: ela só existe depois de
            // aberto. O BV, sim — ele nasce no orçamento e chega aqui.
            ppsPorItemId={new Map()}
            fornecedores={[]}
            empresas={[]}
            jobEmpresaId={jobEmpresaId}
            jobResponsavelId={jobResponsavelId}
            bvsPorItem={bvsPorItem}
            versaoLabel={versaoLabel}
            cartoes={[]}
          />
        ))}
      </div>

      <JobTotaisCard
        grupos={grupos}
        itens={itens}
        realizadosMap={realizadosMap}
        bvsPorItem={bvsPorItem}
        visao={visao}
        // A rota só existe enquanto o job aguarda abertura: o REALIZADO
        // inteiro fica zerado, inclusive nas linhas `A` e `D`.
        jobAberto={false}
        percentualHonorarios={percentualHonorarios}
        percentualImposto={percentualImposto}
        moeda={moeda}
      />
    </>
  );
}
