// app/(app)/jobs/projeto/[projetoId]/page.tsx

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  FolderKanban,
  Lock,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ResumoResultado } from "@/components/resumo-resultado";
import { cn, formatCurrency } from "@/lib/utils";
import { jobStatusLabel, type JobStatus } from "@/lib/types";
import { carregarPlanilhasDosJobs } from "./carregar-planilhas";
import { PlanilhasDoProjeto } from "./planilhas-do-projeto";

export const dynamic = "force-dynamic";

function statusBadgeClasses(status: JobStatus): string {
  switch (status) {
    case "aberto":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "em_producao":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "encerrado":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "cancelado":
      return "border-slate-200 bg-slate-100 text-slate-500";
    case "aguardando_abertura":
      return "border-yellow-200 bg-yellow-50 text-yellow-700";
    case "rejeitado_financeiro":
      return "border-red-200 bg-red-50 text-red-700";
  }
}

export default async function ProjetoAgregadoPage({
  params,
}: {
  params: { projetoId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const { data: projeto } = await supabase
    .from("projetos")
    .select(
      "id, codigo, nome, cliente:clientes(nome_fantasia), responsavel:profiles!responsavel_id(nome)",
    )
    .eq("id", params.projetoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!projeto) notFound();

  const { data: jobsRaw } = await supabase
    .from("jobs")
    .select(
      "id, codigo, nome, status, versao_orcamento_aprovada_id, " +
        "responsavel:profiles!responsavel_id(nome), " +
        "versao:versoes_orcamento!versao_orcamento_aprovada_id(moeda, percentual_honorarios, percentual_imposto)",
    )
    .eq("tenant_id", session.activeTenant.id)
    .eq("projeto_id", params.projetoId)
    .neq("status", "cancelado")
    .order("codigo", { ascending: true });

  const jobs = (jobsRaw ?? []) as unknown as Array<{
    id: string;
    codigo: string;
    nome: string;
    status: JobStatus;
    versao_orcamento_aprovada_id: string;
    responsavel: { nome: string } | null;
    versao: {
      moeda: string;
      percentual_honorarios: number | string;
      percentual_imposto: number | string;
    } | null;
  }>;

  if (jobs.length === 0) notFound();

  const planilhas = await carregarPlanilhasDosJobs(
    session.activeTenant.id,
    jobs.map((j) => j.id),
  );

  const moedaProjeto = planilhas[0]?.moeda ?? "BRL";

  // Resumo do cabeçalho: soma dos fechamentos de cada job, igual ao card de
  // Totais logo abaixo — não existe taxa única do projeto.
  const resumoProjeto = planilhas.reduce(
    (acc, j) => ({
      valorJob: acc.valorJob + j.valorJob,
      faturamentoPrevisto: acc.faturamentoPrevisto + j.faturamentoPrevisto,
      imposto: acc.imposto + j.imposto,
      // Bruto, e a dedução de BV somada à parte: é assim que o painel
      // Resultado escreve a conta (custo bruto + BVs), e é o que faz o
      // resumo do cabeçalho bater com o card de Totais logo abaixo.
      planejado: acc.planejado + j.planejado.bruto,
      realizado: acc.realizado + j.realizado.bruto,
      bvPlanejado: acc.bvPlanejado + j.planejado.deducaoBv,
      bvRealizado: acc.bvRealizado + j.realizado.deducaoBv,
    }),
    {
      valorJob: 0,
      faturamentoPrevisto: 0,
      imposto: 0,
      planejado: 0,
      realizado: 0,
      bvPlanejado: 0,
      bvRealizado: 0,
    },
  );

  const statusMix = jobs.reduce<Record<string, number>>((acc, j) => {
    acc[j.status] = (acc[j.status] ?? 0) + 1;
    return acc;
  }, {});

  const projetoTyped = projeto as any;
  const clienteNome = projetoTyped.cliente?.nome_fantasia ?? "—";
  const responsavelNome = projetoTyped.responsavel?.nome ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para jobs
        </Link>
        {/* O resumo fica ancorado à direita; o bloco do título encolhe
            dentro da própria coluna quando o nome do projeto é longo. */}
        <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="rounded-lg bg-california-red/10 p-2">
              <FolderKanban className="h-5 w-5 text-california-red" />
            </div>
            <div className="min-w-0">
              <p className="font-mono text-xs font-semibold text-muted-foreground">
                {projetoTyped.codigo}
              </p>
              <h1 className="text-2xl font-bold tracking-tight">
                {projetoTyped.nome}
              </h1>
            </div>
          </div>

          {/* Alinha o topo do resumo com o topo das LETRAS do nome do
              projeto: 16px da linha do código + 7px de folga entre a caixa
              de linha do h1 (text-2xl/32px) e o topo das maiúsculas da
              Inter. Medido no navegador. */}
          <div className="mt-[24px]">
            <ResumoResultado
              valorJob={resumoProjeto.valorJob}
              imposto={resumoProjeto.imposto}
              custoPlanejado={resumoProjeto.planejado}
              custoRealizado={resumoProjeto.realizado}
              bvPlanejado={resumoProjeto.bvPlanejado}
              bvRealizado={resumoProjeto.bvRealizado}
              moeda={moedaProjeto}
            />
          </div>
        </div>

        {/* Árvore dos jobs do projeto */}
        <div className="ml-[19px] mt-2.5 flex flex-col">
          {planilhas.map((j, i) => (
            <Link
              key={j.id}
              href={`/jobs/${j.id}?from=jobs`}
              prefetch={false}
              className="group relative grid grid-cols-[28px_auto_1fr] items-center gap-2.5 py-[5px]"
            >
              <span
                aria-hidden="true"
                className="absolute left-0 top-0 w-px bg-[#dad7d7]"
                style={{ height: i === planilhas.length - 1 ? "50%" : "100%" }}
              />
              <span
                aria-hidden="true"
                className="absolute left-0 top-1/2 h-px w-[18px] bg-[#dad7d7]"
              />
              <span />
              <span className="inline-flex items-center gap-2.5 whitespace-nowrap">
                <span className="font-mono text-[11.5px] font-semibold text-[#b3323c]">
                  {j.codigo}
                </span>
                <span className="text-[13px] font-medium text-foreground">
                  {j.nome}
                </span>
                <span className="h-[11px] w-px bg-[#dcdcdc]" />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(j.valorJob, j.moeda)}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-px text-[9.5px] font-semibold uppercase tracking-[0.06em]",
                    statusBadgeClasses(j.status),
                  )}
                >
                  {jobStatusLabel(j.status)}
                </span>
                <ArrowRight className="h-3 w-3 text-[#c9c9c9] transition-colors group-hover:text-california-red" />
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
            Cliente
          </p>
          <p className="mt-1 text-sm font-semibold">{clienteNome}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
            Responsável
          </p>
          <p className="mt-1 text-sm font-semibold">{responsavelNome}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
            Jobs ativos
          </p>
          <p className="mt-1 text-sm font-semibold">{jobs.length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
            Distribuição
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {Object.entries(statusMix)
              .map(([s, n]) => `${n} ${jobStatusLabel(s as JobStatus).toLowerCase()}`)
              .join(" · ")}
          </p>
        </div>
      </div>

      {/* Blocos de job e Totais sob a MESMA chave Bruto ⇄ Líquido. */}
      <PlanilhasDoProjeto planilhas={planilhas} moeda={moedaProjeto} />
    </div>
  );
}
