// app/(app)/jobs/projeto/[projetoId]/page.tsx

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FolderKanban, Calculator } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { agregarRentabilidadePorProjeto, type JobParaAgregar } from "@/lib/calculos/projeto-totais";
import { jobStatusLabel, type JobStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { JobsDoProjetoTable } from "./jobs-do-projeto-table";

export const dynamic = "force-dynamic";

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function ProjetoAgregadoPage({
  params,
}: {
  params: { projetoId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  // 1. Buscar projeto + cliente + responsavel
  const { data: projeto } = await supabase
    .from("projetos")
    .select(
      "id, codigo, nome, cliente:clientes(nome_fantasia), responsavel:profiles!responsavel_id(nome)",
    )
    .eq("id", params.projetoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!projeto) notFound();

  // 2. Buscar jobs ativos (nao cancelados) do projeto
  const { data: jobsRaw } = await supabase
    .from("jobs")
    .select(
      "id, codigo, nome, status, valor_total, versao_orcamento_aprovada_id, responsavel:profiles!responsavel_id(nome)",
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
    valor_total: number | string | null;
    versao_orcamento_aprovada_id: string;
    responsavel: { nome: string } | null;
  }>;

  if (jobs.length === 0) notFound();

  const versaoIds = jobs.map((j) => j.versao_orcamento_aprovada_id);

  // 3. Buscar grupos, itens e realizados em paralelo (todos os jobs de uma vez)
  const [gruposRes, itensRes, realizadosRes] = await Promise.all([
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, nome, versao_orcamento_id, created_at")
      .eq("tenant_id", session.activeTenant.id)
      .in("versao_orcamento_id", versaoIds),
    supabase
      .from("versoes_orcamento_itens")
      .select("id, grupo_id, versao_orcamento_id, total_orcado, total_planejado")
      .eq("tenant_id", session.activeTenant.id)
      .in("versao_orcamento_id", versaoIds),
    supabase
      .from("jobs_itens_realizado")
      .select("item_id, total_realizado, job_id")
      .eq("tenant_id", session.activeTenant.id)
      .in(
        "job_id",
        jobs.map((j) => j.id),
      ),
  ]);

  const gruposByVersao = new Map<string, { id: string; nome: string; created_at: string }[]>();
  for (const g of (gruposRes.data ?? []) as any[]) {
    const arr = gruposByVersao.get(g.versao_orcamento_id) ?? [];
    arr.push({ id: g.id, nome: g.nome, created_at: g.created_at });
    gruposByVersao.set(g.versao_orcamento_id, arr);
  }

  const itensByVersao = new Map<
    string,
    { id: string; grupo_id: string; total_orcado: number | string | null; total_planejado: number | string | null }[]
  >();
  for (const it of (itensRes.data ?? []) as any[]) {
    const arr = itensByVersao.get(it.versao_orcamento_id) ?? [];
    arr.push({
      id: it.id,
      grupo_id: it.grupo_id,
      total_orcado: it.total_orcado,
      total_planejado: it.total_planejado,
    });
    itensByVersao.set(it.versao_orcamento_id, arr);
  }

  const realizadosByJob = new Map<string, Map<string, { total_realizado: number | string | null }>>();
  for (const r of (realizadosRes.data ?? []) as any[]) {
    const m = realizadosByJob.get(r.job_id) ?? new Map();
    m.set(r.item_id, { total_realizado: r.total_realizado });
    realizadosByJob.set(r.job_id, m);
  }

  const jobsParaAgregar: JobParaAgregar[] = jobs.map((j) => ({
    grupos: gruposByVersao.get(j.versao_orcamento_aprovada_id) ?? [],
    itens: itensByVersao.get(j.versao_orcamento_aprovada_id) ?? [],
    realizadosPorItemId: realizadosByJob.get(j.id) ?? new Map(),
  }));

  const { linhas, total } = agregarRentabilidadePorProjeto(jobsParaAgregar);

  // Status mix (breakdown por status)
  const statusMix = jobs.reduce<Record<string, number>>((acc, j) => {
    acc[j.status] = (acc[j.status] ?? 0) + 1;
    return acc;
  }, {});

  const projetoTyped = projeto as any;
  const clienteNome = projetoTyped.cliente?.nome_fantasia ?? "—";
  const responsavelNome = projetoTyped.responsavel?.nome ?? "—";

  const deltaOrc = total.realizado - total.orcado;
  const deltaPlan = total.realizado - total.planejado;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para jobs
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <FolderKanban className="h-5 w-5 text-california-red" />
          </div>
          <div>
            <p className="font-mono text-xs font-semibold text-muted-foreground">
              {projetoTyped.codigo}
            </p>
            <h1 className="text-2xl font-bold tracking-tight">{projetoTyped.nome}</h1>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cliente</p>
          <p className="mt-1 text-sm font-semibold">{clienteNome}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Responsável</p>
          <p className="mt-1 text-sm font-semibold">{responsavelNome}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Jobs ativos</p>
          <p className="mt-1 text-sm font-semibold">{jobs.length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Distribuição</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {Object.entries(statusMix)
              .map(([s, n]) => `${n} ${jobStatusLabel(s as JobStatus).toLowerCase()}`)
              .join(" · ")}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <div className="flex items-center gap-2 border-b border-border p-6">
          <Calculator className="h-5 w-5 text-california-red" />
          <div>
            <h2 className="text-lg font-semibold leading-none tracking-tight">
              Rentabilidade agregada
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Orçado × Planejado × Realizado somados por grupo entre todos os jobs.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Grupo</th>
                <th className="px-4 py-3 font-semibold text-right">Orçado</th>
                <th className="px-4 py-3 font-semibold text-right">Planejado</th>
                <th className="px-4 py-3 font-semibold text-right">Realizado</th>
                <th className="px-4 py-3 font-semibold text-right">Δ Real vs Orç</th>
                <th className="px-4 py-3 font-semibold text-right">Δ Real vs Plan</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Sem itens orçados nos jobs deste projeto.
                  </td>
                </tr>
              )}
              {linhas.map((l) => {
                const dOrc = l.realizado - l.orcado;
                const dPlan = l.realizado - l.planejado;
                return (
                  <tr key={l.chaveNormalizada} className="border-b border-border">
                    <td className="px-4 py-3 font-medium">{l.nomeExibicao}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatMoney(l.orcado)}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {l.planejado > 0 ? formatMoney(l.planejado) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {l.realizado > 0 ? formatMoney(l.realizado) : "—"}
                    </td>
                    <td className={cn("px-4 py-3 text-right font-mono", dOrc > 0 ? "text-california-red" : "text-emerald-700")}>
                      {formatMoney(dOrc)}
                    </td>
                    <td className={cn("px-4 py-3 text-right font-mono", dPlan > 0 ? "text-california-red" : "text-emerald-700")}>
                      {formatMoney(dPlan)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-t-border bg-muted/20">
                <td className="px-4 py-3 font-semibold uppercase tracking-wider text-xs">Total</td>
                <td className="px-4 py-3 text-right font-mono font-bold">
                  {formatMoney(total.orcado)}
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold">
                  {total.planejado > 0 ? formatMoney(total.planejado) : "—"}
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold">
                  {total.realizado > 0 ? formatMoney(total.realizado) : "—"}
                </td>
                <td className={cn("px-4 py-3 text-right font-mono font-bold", deltaOrc > 0 ? "text-california-red" : "text-emerald-700")}>
                  {formatMoney(deltaOrc)}
                </td>
                <td className={cn("px-4 py-3 text-right font-mono font-bold", deltaPlan > 0 ? "text-california-red" : "text-emerald-700")}>
                  {formatMoney(deltaPlan)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
        <div className="border-b border-border p-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Jobs do projeto
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {jobs.length} jobs ativos. Clique em um para abrir os detalhes.
          </p>
        </div>
        <JobsDoProjetoTable jobs={jobs} />
      </div>
    </div>
  );
}
