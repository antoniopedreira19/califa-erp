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
import { MenuExibirColunas } from "@/app/(app)/_planilha/exibir-colunas";
import { PlanilhaJobCard } from "./planilha-job-card";
import { ProjetoTotaisCard } from "./projeto-totais-card";
import type { JobPlanilhaProjeto } from "./tipos";

export function PlanilhasDoProjeto({
  planilhas,
  moeda,
  jobHrefBase,
  saveSempreVisivel = false,
}: {
  planilhas: JobPlanilhaProjeto[];
  moeda: string;
  /** Prefixo da rota de "Abrir job" — o id é concatenado aqui dentro. O
   *  financeiro passa `/financeiro/jobs`: aquele módulo não encaminha
   *  para telas de outros. Ausente ⇒ a rota de Jobs, com `?from=jobs`.
   *
   *  ⚠️ É uma STRING, e não a função `(id) => string` que os dois cards
   *  recebem. Este componente é client, e função não atravessa a
   *  fronteira server → client: passar a função rendia
   *  "Functions cannot be passed directly to Client Components" e a
   *  página inteira em branco. `tsc`, `lint` e `build` passam mesmo
   *  assim — só abrir a rota pega. A função é montada aqui, do lado
   *  client, onde ela é inofensiva. */
  jobHrefBase?: string;
  /** Financeiro: a coluna Save fica SEMPRE presente e sem liga-desliga —
   *  aquele módulo confere o crédito entre jobs, e esconder a coluna
   *  esconderia justamente o que ele foi ver. */
  saveSempreVisivel?: boolean;
}) {
  const [visao, setVisao] = React.useState<VisaoBv>(VISAO_BV_PADRAO);

  // A coluna nasce aberta em quem já usa save e fechada em quem nunca
  // usou — a mesma regra das planilhas internas.
  const algumJobTemSave = planilhas.some((j) => j.temSave);
  const [saveLigado, setSaveLigado] = React.useState(algumJobTemSave);
  const saveVisivel = saveSempreVisivel || saveLigado;

  const rotaDoJob = React.useMemo(
    () =>
      jobHrefBase ? (id: string) => `${jobHrefBase}/${id}` : undefined,
    [jobHrefBase],
  );

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
          {/* O liga-desliga da coluna Save fica AQUI, e não colado na
              tabela como nas planilhas internas, por dois motivos: o
              estado é um só para a tela (o card de Totais divide o
              `colgroup` com os blocos e não teria qual alça seguir), e o
              card de cada job é `overflow-hidden` — uma alça em
              `right-full` seria cortada pela borda dele. É o mesmo
              controle das internas, no mesmo lugar da barra. */}
          {!saveSempreVisivel && (
            <MenuExibirColunas
              blocos={[
                {
                  chave: "save",
                  rotulo: "Save",
                  visivel: saveVisivel,
                  onAlternar: () => setSaveLigado((v) => !v),
                },
                { chave: "orcado", rotulo: "Orçado", visivel: true },
                { chave: "planejado", rotulo: "Planejado", visivel: true },
                { chave: "realizado", rotulo: "Realizado", visivel: true },
              ]}
            />
          )}
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
          saveVisivel={saveVisivel}
          jobHref={rotaDoJob?.(j.id)}
        />
      ))}

      <ProjetoTotaisCard
        jobs={planilhas}
        moeda={moeda}
        visao={visao}
        jobHref={rotaDoJob}
      />
    </>
  );
}
