"use client";

/** Os blocos de job e o card de Totais do projeto, sob uma chave só.
 *
 *  Mesmo motivo de `PlanilhaVersao` e `JobRealizadoSection`: a chave
 *  Bruto ⇄ Líquido vale para a página inteira, e aqui a página tem N
 *  blocos de job mais o Totais. Dois deles em modos diferentes deixariam
 *  o consolidado sem bater com nenhum.
 *
 *  Compartilhado pelas DUAS telas de projeto — a da produção
 *  (`/jobs/projeto/[projetoId]`) e a do financeiro
 *  (`/financeiro/projetos/[projetoId]`) —, que mostram a mesma planilha
 *  com recortes diferentes. O que muda entre elas é o `jobHref`.
 */

import * as React from "react";
import { ClipboardList, Lock } from "lucide-react";
import { VISAO_BV_PADRAO, type VisaoBv } from "@/lib/calculos/bv-planilha";
import { ChaveBrutoLiquido } from "@/app/(app)/_planilha/chave-bruto-liquido";
import { PlanilhaJobCard } from "./planilha-job-card";
import { ProjetoTotaisCard } from "./projeto-totais-card";
import type { JobPlanilhaProjeto } from "./tipos";

export function PlanilhasDoProjeto({
  planilhas,
  moeda,
  jobHref,
}: {
  planilhas: JobPlanilhaProjeto[];
  moeda: string;
  /** Para onde "Abrir job" leva. O financeiro passa a rota dele: aquele
   *  módulo não encaminha para telas de outros. */
  jobHref?: (id: string) => string;
}) {
  const [visao, setVisao] = React.useState<VisaoBv>(VISAO_BV_PADRAO);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ClipboardList className="h-4 w-4 text-california-red" />
          <span>
            Planilha consolidada · um bloco por job · Orçado × Planejado ×
            Realizado
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ChaveBrutoLiquido visao={visao} onChange={setVisao} />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-[11px] py-1 text-[11px] font-semibold text-muted-foreground">
            <Lock className="h-[11px] w-[11px]" />
            Somente leitura
          </span>
        </div>
      </div>

      {planilhas.map((j) => (
        <PlanilhaJobCard
          key={j.id}
          job={j}
          visao={visao}
          jobHref={jobHref?.(j.id)}
        />
      ))}

      <ProjetoTotaisCard
        jobs={planilhas}
        moeda={moeda}
        visao={visao}
        jobHref={jobHref}
      />
    </>
  );
}
