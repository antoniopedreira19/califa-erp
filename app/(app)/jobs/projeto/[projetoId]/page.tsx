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
import { calcularTotaisVersao } from "@/lib/calculos/versao-totais";
import { ResumoResultado } from "@/components/resumo-resultado";
import { cn, formatCurrency } from "@/lib/utils";
import { jobStatusLabel, type JobStatus, type TipoCusto } from "@/lib/types";
import { PlanilhaJobCard } from "./planilha-job-card";
import { ProjetoTotaisCard } from "./projeto-totais-card";
import type {
  GrupoPlanilhaProjeto,
  ItemPlanilhaProjeto,
  JobPlanilhaProjeto,
} from "./tipos";

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

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
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

  const versaoIds = jobs.map((j) => j.versao_orcamento_aprovada_id);
  const jobIds = jobs.map((j) => j.id);

  // Orçado vem da CÓPIA de cada job (`jobs_itens_orcado`), não da versão: a
  // errata altera a cópia, e a visão agregada precisa bater com a Planilha
  // Interna do job — a versão aprovada segue congelada.
  const [gruposRes, itensRes, realizadosRes, categoriasRes] = await Promise.all([
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, nome, versao_orcamento_id, ordem")
      .eq("tenant_id", session.activeTenant.id)
      .in("versao_orcamento_id", versaoIds)
      .order("ordem", { ascending: true }),
    supabase
      .from("jobs_itens_orcado")
      .select(
        "id, job_id, item_versao_id, grupo_id, ordem, item, tipo_custo, categoria_id, " +
          "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, total_orcado, " +
          "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, total_planejado",
      )
      .eq("tenant_id", session.activeTenant.id)
      .in("job_id", jobIds)
      .order("ordem", { ascending: true }),
    supabase
      .from("jobs_itens_realizado")
      .select(
        "job_id, item_id, valor_unitario_realizado, quantidade_realizada, dias_meses_realizado, total_realizado",
      )
      .eq("tenant_id", session.activeTenant.id)
      .in("job_id", jobIds),
    supabase
      .from("categorias")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id),
  ]);

  if (gruposRes.error) console.error("[projeto.grupos]", gruposRes.error.message);
  if (itensRes.error) console.error("[projeto.orcado]", itensRes.error.message);

  const categoriasMap = new Map<string, string>();
  for (const c of (categoriasRes.data ?? []) as any[]) {
    categoriasMap.set(c.id, c.nome);
  }

  const gruposPorVersao = new Map<string, { id: string; nome: string }[]>();
  for (const g of (gruposRes.data ?? []) as any[]) {
    const arr = gruposPorVersao.get(g.versao_orcamento_id) ?? [];
    arr.push({ id: g.id, nome: g.nome });
    gruposPorVersao.set(g.versao_orcamento_id, arr);
  }

  const itensPorJob = new Map<string, any[]>();
  for (const it of (itensRes.data ?? []) as any[]) {
    const arr = itensPorJob.get(it.job_id) ?? [];
    arr.push(it);
    itensPorJob.set(it.job_id, arr);
  }

  // Chave por job + item da versão: `jobs_itens_realizado.item_id` aponta pro
  // item da versão, que se repete entre jobs de versões diferentes só por
  // acaso — o job_id evita qualquer cruzamento.
  const realizadosPorChave = new Map<
    string,
    { unit: number; qt: number; dm: number; total: number }
  >();
  for (const r of (realizadosRes.data ?? []) as any[]) {
    realizadosPorChave.set(`${r.job_id}/${r.item_id}`, {
      unit: num(r.valor_unitario_realizado),
      qt: num(r.quantidade_realizada),
      dm: num(r.dias_meses_realizado),
      total: num(r.total_realizado),
    });
  }

  const planilhas: JobPlanilhaProjeto[] = jobs.map((j) => {
    const itensDoJob = itensPorJob.get(j.id) ?? [];
    const gruposDaVersao = gruposPorVersao.get(j.versao_orcamento_aprovada_id) ?? [];

    const grupos: GrupoPlanilhaProjeto[] = gruposDaVersao.map((g) => {
      const itens: ItemPlanilhaProjeto[] = itensDoJob
        .filter((it) => it.grupo_id === g.id)
        .map((it) => {
          const real = realizadosPorChave.get(`${j.id}/${it.item_versao_id}`);
          return {
            id: it.id,
            nome: it.item,
            tipo: it.tipo_custo as TipoCusto,
            categoria: it.categoria_id
              ? (categoriasMap.get(it.categoria_id) ?? null)
              : null,
            orcUnit: num(it.valor_unitario_orcado),
            orcQt: num(it.quantidade_orcada),
            orcDm: num(it.dias_meses_orcado),
            orcTotal: num(it.total_orcado),
            planUnit: num(it.valor_unitario_planejado),
            planQt: num(it.quantidade_planejada),
            planDm: num(it.dias_meses_planejado),
            planTotal: num(it.total_planejado),
            realUnit: real?.unit ?? 0,
            realQt: real?.qt ?? 0,
            realDm: real?.dm ?? 0,
            realTotal: real?.total ?? 0,
          };
        });

      return {
        id: g.id,
        nome: g.nome,
        itens,
        orcado: itens.reduce((s, i) => s + i.orcTotal, 0),
        planejado: itens.reduce((s, i) => s + i.planTotal, 0),
        realizado: itens.reduce((s, i) => s + i.realTotal, 0),
      };
    });

    const percentualHonorarios = num(j.versao?.percentual_honorarios);
    const percentualImposto = num(j.versao?.percentual_imposto);

    // Mesma função da tela da versão e do card de Totais do job: o
    // fechamento do projeto é a soma dos fechamentos, não uma conta nova.
    const {
      subtotaisPorTipo,
      subtotalGeral,
      honorarios,
      imposto,
      faturamentoPrevisto,
      valorJob,
    } = calcularTotaisVersao(
        itensDoJob.map((it) => ({
          tipo_custo: it.tipo_custo as TipoCusto,
          total_orcado: num(it.total_orcado),
        })),
        percentualHonorarios,
        percentualImposto,
      );

    return {
      id: j.id,
      codigo: j.codigo,
      nome: j.nome,
      status: j.status,
      responsavel: j.responsavel?.nome ?? null,
      moeda: j.versao?.moeda ?? "BRL",
      percentualHonorarios,
      percentualImposto,
      grupos,
      orcado: subtotalGeral,
      planejado: grupos.reduce((s, g) => s + g.planejado, 0),
      realizado: grupos.reduce((s, g) => s + g.realizado, 0),
      subtotaisPorTipo,
      honorarios,
      imposto,
      faturamentoPrevisto,
      valorJob,
    };
  });

  const moedaProjeto = planilhas[0]?.moeda ?? "BRL";

  // Resumo do cabeçalho: soma dos fechamentos de cada job, igual ao card de
  // Totais logo abaixo — não existe taxa única do projeto.
  const resumoProjeto = planilhas.reduce(
    (acc, j) => ({
      valorJob: acc.valorJob + j.valorJob,
      faturamentoPrevisto: acc.faturamentoPrevisto + j.faturamentoPrevisto,
      imposto: acc.imposto + j.imposto,
      planejado: acc.planejado + j.planejado,
      realizado: acc.realizado + j.realizado,
    }),
    {
      valorJob: 0,
      faturamentoPrevisto: 0,
      imposto: 0,
      planejado: 0,
      realizado: 0,
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
              faturamentoPrevisto={resumoProjeto.faturamentoPrevisto}
              imposto={resumoProjeto.imposto}
              custoPlanejado={resumoProjeto.planejado}
              custoRealizado={resumoProjeto.realizado}
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

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ClipboardList className="h-4 w-4 text-california-red" />
          <span>
            Planilha consolidada · um bloco por job · Orçado × Planejado ×
            Realizado
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-[11px] py-1 text-[11px] font-semibold text-muted-foreground">
          <Lock className="h-[11px] w-[11px]" />
          Somente leitura
        </span>
      </div>

      {planilhas.map((j) => (
        <PlanilhaJobCard key={j.id} job={j} />
      ))}

      <ProjetoTotaisCard jobs={planilhas} moeda={moedaProjeto} />
    </div>
  );
}
