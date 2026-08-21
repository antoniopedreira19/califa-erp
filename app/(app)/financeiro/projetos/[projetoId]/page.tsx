import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  FolderKanban,
  Lock,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  jobStatusLabel,
  nomeDoJobNoFinanceiro,
  type JobStatus,
} from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";
import { ResumoResultado } from "@/components/resumo-resultado";
import { FluxoCaixaJobs } from "@/components/financeiro/fluxo-caixa-jobs";
import { listarContasBancarias } from "@/lib/data/contas-bancarias";
import { carregarPlanilhasDosJobs } from "@/app/(app)/jobs/projeto/[projetoId]/carregar-planilhas";
import { PlanilhasDoProjeto } from "@/app/(app)/jobs/projeto/[projetoId]/planilhas-do-projeto";
import { STATUS_NA_LISTA } from "../../abertura-de-job/dados-abertos";
import {
  carregarLinhasDeFluxo,
  carregarPrazosDosJobs,
} from "../../jobs/[jobId]/fluxo-do-job";
import { ProjetoTabs } from "./projeto-tabs";

export const dynamic = "force-dynamic";

function statusBadgeClasses(status: JobStatus): string {
  switch (status) {
    case "aberto":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "em_producao":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "encerrado":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-500";
  }
}

/**
 * A visão agregada do projeto NO FINANCEIRO.
 *
 * É a mesma tela da visão agregada da produção (`/jobs/projeto/[id]`) —
 * árvore dos jobs, cards, um bloco de planilha por job e o card de Totais
 * consolidado —, no recorte do financeiro: os jobs vêm do projeto DO
 * FINANCEIRO (`projeto_financeiro_id`) e cada bloco leva o
 * `nome_financeiro`. A planilha é montada pelo MESMO
 * `carregarPlanilhasDosJobs` das duas telas; duas cópias divergiriam na
 * primeira errata.
 *
 * Rota própria, e não a da produção, porque o financeiro não encaminha
 * para telas de outros módulos (decisão do Tiago, 20/08/2026) e porque o
 * agrupamento aqui é outro: o mesmo projeto do financeiro pode juntar
 * jobs que na produção estão em projetos diferentes.
 *
 * Duas abas (21/08/2026): a planilha agregada e o fluxo de caixa somado
 * dos jobs do projeto.
 *
 * Entram só os jobs da aba "Visualizar Jobs" (`STATUS_NA_LISTA`): a visão
 * agregada unifica o que está lá, e job aguardando abertura tem aba
 * própria.
 */
export default async function ProjetoNoFinanceiroPage({
  params,
}: {
  params: { projetoId: string };
}) {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const hoje = new Date().toISOString().slice(0, 10);

  const [projetoRes, jobsRes] = await Promise.all([
    supabase
      .from("projetos_financeiro")
      .select("id, codigo, nome, cliente:clientes(nome_fantasia)")
      .eq("id", params.projetoId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("jobs")
      .select("id, codigo, nome, nome_financeiro, status")
      .eq("tenant_id", tenantId)
      .eq("projeto_financeiro_id", params.projetoId)
      .in("status", STATUS_NA_LISTA as unknown as string[])
      .order("codigo", { ascending: true }),
  ]);

  if (projetoRes.error) {
    console.error("[projeto-financeiro]", projetoRes.error.message);
  }
  const projeto = projetoRes.data as any;
  if (!projeto) notFound();

  if (jobsRes.error) {
    console.error("[projeto-financeiro.jobs]", jobsRes.error.message);
  }

  const jobsDoProjeto = ((jobsRes.data ?? []) as any[]).map((j) => ({
    id: j.id as string,
    codigo: j.codigo as string,
    nome: nomeDoJobNoFinanceiro(j),
    status: j.status as JobStatus,
  }));
  const jobIds = jobsDoProjeto.map((j) => j.id);

  // Independentes entre si — em paralelo, nunca em série
  // (`docs/PERFORMANCE.md`).
  const [planilhas, linhasDeFluxo, prazos, contas] = await Promise.all([
    carregarPlanilhasDosJobs(tenantId, jobIds, { usarNomeFinanceiro: true }),
    carregarLinhasDeFluxo(tenantId, jobIds),
    carregarPrazosDosJobs(tenantId, jobIds),
    listarContasBancarias(tenantId),
  ]);

  const moedaProjeto = planilhas[0]?.moeda ?? "BRL";

  // Soma dos fechamentos de cada job, igual ao card de Totais da aba —
  // não existe taxa única do projeto.
  const resumo = planilhas.reduce(
    (acc, j) => ({
      valorJob: acc.valorJob + j.valorJob,
      imposto: acc.imposto + j.imposto,
      // Bruto, com a dedução de BV somada à parte — a mesma forma do
      // painel Resultado (custo bruto + BVs), para o resumo bater com o
      // card de Totais da aba (docs/decisions/022).
      planejado: acc.planejado + j.planejado.bruto,
      realizado: acc.realizado + j.realizado.bruto,
      bvPlanejado: acc.bvPlanejado + j.planejado.deducaoBv,
      bvRealizado: acc.bvRealizado + j.realizado.deducaoBv,
    }),
    {
      valorJob: 0,
      imposto: 0,
      planejado: 0,
      realizado: 0,
      bvPlanejado: 0,
      bvRealizado: 0,
    },
  );

  const statusMix = jobsDoProjeto.reduce<Record<string, number>>((acc, j) => {
    acc[j.status] = (acc[j.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mx-auto flex max-w-[1452px] flex-col gap-6 min-[1600px]:mr-6">
      <div>
        <Link
          href="/financeiro/abertura-de-job?aba=abertos"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para Visualizar Jobs
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="rounded-lg bg-california-red/10 p-2">
              <FolderKanban className="h-5 w-5 text-california-red" />
            </div>
            <div className="min-w-0">
              <p className="font-mono text-xs font-semibold text-muted-foreground">
                {projeto.codigo}
              </p>
              <h1 className="text-2xl font-bold tracking-tight">
                {projeto.nome}
              </h1>
            </div>
          </div>

          {planilhas.length > 0 && (
            <div className="mt-[24px]">
              <ResumoResultado
                valorJob={resumo.valorJob}
                imposto={resumo.imposto}
                custoPlanejado={resumo.planejado}
                custoRealizado={resumo.realizado}
                bvPlanejado={resumo.bvPlanejado}
                bvRealizado={resumo.bvRealizado}
                moeda={moedaProjeto}
              />
            </div>
          )}
        </div>

        {/* Árvore dos jobs, como na visão agregada da produção — mas os
            links ficam dentro do financeiro. */}
        <div className="ml-[19px] mt-2.5 flex flex-col">
          {jobsDoProjeto.map((j, i) => {
            const planilha = planilhas.find((p) => p.id === j.id);
            return (
              <Link
                key={j.id}
                href={`/financeiro/jobs/${j.id}`}
                prefetch={false}
                className="group relative grid grid-cols-[28px_auto_1fr] items-center gap-2.5 py-[5px]"
              >
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-0 w-px bg-[#dad7d7]"
                  style={{
                    height: i === jobsDoProjeto.length - 1 ? "50%" : "100%",
                  }}
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
                    {formatCurrency(planilha?.valorJob ?? 0, moedaProjeto)}
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
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <CardResumo
          rotulo="Cliente"
          valor={projeto.cliente?.nome_fantasia ?? "—"}
        />
        <CardResumo
          rotulo="Jobs no financeiro"
          valor={String(jobsDoProjeto.length)}
        />
        <CardResumo
          rotulo="Valor do projeto"
          valor={formatCurrency(resumo.valorJob, moedaProjeto)}
        />
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
            Distribuição
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {Object.entries(statusMix)
              .map(
                ([s, n]) =>
                  `${n} ${jobStatusLabel(s as JobStatus).toLowerCase()}`,
              )
              .join(" · ") || "—"}
          </p>
        </div>
      </div>

      {jobsDoProjeto.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground shadow-soft">
          Nenhum job aberto no financeiro neste projeto.
        </div>
      ) : (
        <ProjetoTabs
          planilha={
            <>
              {/* Blocos de job e Totais sob a MESMA chave Bruto ⇄
                  Líquido — o mesmo componente da tela de projeto da
                  produção, com o recorte de rota do financeiro. */}
              <PlanilhasDoProjeto
                planilhas={planilhas}
                moeda={moedaProjeto}
                jobHref={(id) => `/financeiro/jobs/${id}`}
              />
            </>
          }
          fluxo={
            <FluxoCaixaJobs
              linhas={linhasDeFluxo}
              jobs={jobsDoProjeto.map((j) => ({
                id: j.id,
                codigo: j.codigo,
                nome: j.nome,
              }))}
              contas={contas.map((c) => ({ id: c.id, rotulo: c.rotulo }))}
              prazos={prazos}
              hoje={hoje}
              moeda={moedaProjeto}
              descricao="Os fluxos de todos os jobs deste projeto, somados: o realizado (movimentos das contas) mais o previsto (títulos em aberto e as previsões da abertura). Filtre por job ou por conta para isolar uma parte."
            />
          }
        />
      )}
    </div>
  );
}

function CardResumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <p className="text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
        {rotulo}
      </p>
      <p className="mt-1 truncate text-sm font-semibold">{valor}</p>
    </div>
  );
}
