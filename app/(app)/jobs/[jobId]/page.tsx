import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase, Layers, Info, Circle } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import type { Job, JobStatus, Regional } from "@/lib/types";
import { jobStatusLabel, JOB_STATUS_TRANSICOES } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { JobEditorDrawer } from "./job-editor-drawer";
import { EditarHierarquiaDrawer } from "./editar-hierarquia-drawer";
import { StatusActions } from "./status-actions";
import { ReenviarAprovacaoButton } from "./reenviar-aprovacao-button";
import { AprovarRejeitarButtons } from "./aprovar-rejeitar-buttons";
import { JobRealizadoSection } from "./realizado/job-realizado-section";
import type {
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
  JobItemRealizado,
} from "@/lib/types";

export const dynamic = "force-dynamic";

function statusBadgeClasses(status: JobStatus): string {
  switch (status) {
    case "aberto":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "em_producao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "finalizado":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "cancelado":
      return "bg-slate-100 text-slate-500 border-slate-200";
    case "aguardando_abertura":
      return "bg-yellow-50 text-yellow-700 border-yellow-200";
    case "rejeitado_financeiro":
      return "bg-red-50 text-red-700 border-red-200";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function JobDetailPage({
  params,
}: {
  params: { jobId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const [jobRes, regionaisRes, responsaveis] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, tenant_id, codigo, nome, produto, cidade, data_inicio_prevista, data_fim_prevista, responsavel_id, valor_total, status, motivo_rejeicao, projeto_id, orcamento_id, versao_orcamento_aprovada_id, regional_id, job_pai_id, created_at, updated_at, responsavel:profiles!responsavel_id(id, nome), regional:regionais(id, nome), orcamento:orcamentos(id, codigo, nome, projeto_id), versao:versoes_orcamento!versao_orcamento_aprovada_id(id, numero_versao, nome, moeda, percentual_honorarios, percentual_imposto), projeto:projetos(id, codigo, nome), pai:jobs!job_pai_id(id, codigo, nome)",
      )
      .eq("id", params.jobId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    listActiveMembers(session.activeTenant.id),
  ]);

  if (jobRes.error) console.error("[job.detail]", jobRes.error.message);
  const raw = jobRes.data as any;
  if (!raw) notFound();

  // Fetch sub-jobs se este é principal
  let subJobs: { id: string; codigo: string; nome: string; status: JobStatus }[] = [];
  if (raw.job_pai_id === null) {
    const { data: subs } = await supabase
      .from("jobs")
      .select("id, codigo, nome, status")
      .eq("projeto_id", raw.projeto_id)
      .eq("job_pai_id", raw.id)
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at");
    subJobs = (subs ?? []) as any[];
  }

  // Fetch outros jobs ativos do mesmo projeto (pra saber se hierarquia é editável)
  const { count: outrosAtivos } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("projeto_id", raw.projeto_id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("id", raw.id)
    .neq("status", "cancelado");

  const podeEditarHierarquia = (outrosAtivos ?? 0) > 0;
  const ehPrincipal = raw.job_pai_id === null;

  // Queries de Realizado (paralelas, dependem de raw ja carregado)
  const versaoAprovadaId = raw.versao_orcamento_aprovada_id as string;

  const [gruposRes, itensRes, realizadosRes] = await Promise.all([
    supabase
      .from("versoes_orcamento_grupos")
      .select("*")
      .eq("versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .returns<VersaoOrcamentoGrupo[]>(),
    supabase
      .from("versoes_orcamento_itens")
      .select("*")
      .eq("versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .returns<VersaoOrcamentoItem[]>(),
    supabase
      .from("jobs_itens_realizado")
      .select("*")
      .eq("job_id", raw.id)
      .eq("tenant_id", session.activeTenant.id)
      .returns<JobItemRealizado[]>(),
  ]);

  const grupos = (gruposRes.data ?? []) as VersaoOrcamentoGrupo[];
  const itens: VersaoOrcamentoItem[] = (itensRes.data ?? []).map((it: any) => ({
    ...it,
    valor_unitario_orcado: Number(it.valor_unitario_orcado ?? 0),
    quantidade_orcada: Number(it.quantidade_orcada ?? 1),
    dias_meses_orcado: Number(it.dias_meses_orcado ?? 1),
    total_orcado: Number(it.total_orcado ?? 0),
    valor_unitario_planejado: Number(it.valor_unitario_planejado ?? 0),
    quantidade_planejada: Number(it.quantidade_planejada ?? 0),
    dias_meses_planejado: Number(it.dias_meses_planejado ?? 0),
    total_planejado: Number(it.total_planejado ?? 0),
  }));
  const realizados = (realizadosRes.data ?? []).map((r: any) => ({
    ...r,
    valor_unitario_realizado: Number(r.valor_unitario_realizado ?? 0),
    quantidade_realizada: Number(r.quantidade_realizada ?? 0),
    dias_meses_realizado: Number(r.dias_meses_realizado ?? 0),
    total_realizado: Number(r.total_realizado ?? 0),
  })) as JobItemRealizado[];

  const realizadosMap = new Map<string, JobItemRealizado>();
  for (const r of realizados) realizadosMap.set(r.item_id, r);

  const versaoAprovada = raw.versao as {
    id: string;
    numero_versao: number;
    nome: string | null;
    moeda: string;
    percentual_honorarios: number;
    percentual_imposto: number;
  };

  const transicoes = JOB_STATUS_TRANSICOES[raw.status as JobStatus];

  const regionais = (regionaisRes.data ?? []) as Pick<Regional, "id" | "nome">[];

  const job: Job = {
    id: raw.id,
    tenant_id: raw.tenant_id,
    codigo: raw.codigo,
    projeto_id: raw.projeto_id,
    orcamento_id: raw.orcamento_id,
    versao_orcamento_aprovada_id: raw.versao_orcamento_aprovada_id,
    nome: raw.nome,
    produto: raw.produto,
    regional_id: raw.regional_id,
    cidade: raw.cidade,
    data_inicio_prevista: raw.data_inicio_prevista,
    data_fim_prevista: raw.data_fim_prevista,
    responsavel_id: raw.responsavel_id,
    valor_total: raw.valor_total !== null ? Number(raw.valor_total) : null,
    job_pai_id: raw.job_pai_id,
    status: raw.status,
    motivo_rejeicao: raw.motivo_rejeicao ?? null,
    created_by: null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };

  const podeAprovarRejeitar =
    session.activeRole === "administrador" ||
    session.activeRole === "financeiro";

  const podeEditarRealizado =
    (session.activeRole === "administrador" ||
      job.responsavel_id === session.profile.id) &&
    (job.status === "aberto" || job.status === "em_producao");

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <Link
          href={`/orcamentos/${raw.projeto_id}/${raw.orcamento_id}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para orçamento {raw.orcamento?.codigo}
        </Link>
        <div className="mt-3">
          <p className="font-mono text-xs font-semibold text-muted-foreground">{job.codigo}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{job.nome}</h1>
            <Badge className={cn("border", statusBadgeClasses(job.status))}>
              {jobStatusLabel(job.status)}
            </Badge>
            {job.status !== "cancelado" && (
              <JobEditorDrawer
                job={job}
                regionais={regionais}
                responsaveis={responsaveis}
              />
            )}
          </div>
        </div>
      </div>

      {job.status === "rejeitado_financeiro" && job.motivo_rejeicao && (
        <div className="rounded-2xl border border-california-red/30 bg-california-red/5 p-6 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wider text-california-red mb-2">
            Motivo da rejeição pelo financeiro
          </p>
          <p className="text-sm text-foreground whitespace-pre-wrap">{job.motivo_rejeicao}</p>
          <div className="mt-4">
            <ReenviarAprovacaoButton jobId={job.id} />
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <div className="flex items-center gap-2 mb-4">
            <Info className="h-4 w-4 text-california-red" />
            <h2 className="text-sm font-semibold uppercase tracking-wider">Metadata</h2>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Cliente</dt>
            <dd className="font-medium">{raw.projeto?.nome ?? "—"}</dd>
            <dt className="text-muted-foreground">Produto</dt>
            <dd>{job.produto ?? "—"}</dd>
            <dt className="text-muted-foreground">Regional</dt>
            <dd>{raw.regional?.nome ?? "—"}</dd>
            <dt className="text-muted-foreground">Cidade</dt>
            <dd>{job.cidade ?? "—"}</dd>
            <dt className="text-muted-foreground">Data início</dt>
            <dd>{formatDate(job.data_inicio_prevista)}</dd>
            <dt className="text-muted-foreground">Data fim</dt>
            <dd>{formatDate(job.data_fim_prevista)}</dd>
            <dt className="text-muted-foreground">Responsável</dt>
            <dd>{raw.responsavel?.nome ?? "—"}</dd>
            <dt className="text-muted-foreground">Valor total</dt>
            <dd className="font-semibold">{formatMoney(job.valor_total)}</dd>
          </dl>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="h-4 w-4 text-california-red" />
            <h2 className="text-sm font-semibold uppercase tracking-wider">Hierarquia</h2>
          </div>
          {ehPrincipal ? (
            <div className="space-y-3 text-sm">
              <p>
                <span className="font-semibold">Este é o job principal</span> do projeto.
              </p>
              {subJobs.length > 0 && (
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wider mb-2">Sub-jobs</p>
                  <ul className="space-y-1">
                    {subJobs.map((s) => (
                      <li key={s.id}>
                        <Link
                          href={`/jobs/${s.id}`}
                          prefetch={false}
                          className="text-california-red hover:underline"
                        >
                          {s.codigo} · {s.nome}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {podeEditarHierarquia && job.status !== "cancelado" && (
                <EditarHierarquiaDrawer jobId={job.id} papelAtual="principal" />
              )}
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p>
                Sub-job de:{" "}
                {raw.pai && (
                  <Link
                    href={`/jobs/${raw.pai.id}`}
                    prefetch={false}
                    className="font-mono text-california-red hover:underline"
                  >
                    {raw.pai.codigo} · {raw.pai.nome}
                  </Link>
                )}
              </p>
              {podeEditarHierarquia && job.status !== "cancelado" && (
                <EditarHierarquiaDrawer jobId={job.id} papelAtual="sub_job" />
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Briefcase className="h-4 w-4 text-california-red" />
            <h2 className="text-sm font-semibold uppercase tracking-wider">Origem</h2>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Projeto</dt>
            <dd>
              <Link
                href={`/orcamentos/${raw.projeto_id}`}
                prefetch={false}
                className="text-california-red hover:underline"
              >
                <span className="font-mono">{raw.projeto?.codigo}</span> · {raw.projeto?.nome}
              </Link>
            </dd>
            <dt className="text-muted-foreground">Orçamento</dt>
            <dd>
              <Link
                href={`/orcamentos/${raw.projeto_id}/${raw.orcamento_id}`}
                prefetch={false}
                className="text-california-red hover:underline"
              >
                <span className="font-mono">{raw.orcamento?.codigo}</span> · {raw.orcamento?.nome}
              </Link>
            </dd>
            <dt className="text-muted-foreground">Versão aprovada</dt>
            <dd>
              <Link
                href={`/orcamentos/${raw.projeto_id}/${raw.orcamento_id}/versoes/${raw.versao_orcamento_aprovada_id}`}
                prefetch={false}
                className="text-california-red hover:underline"
              >
                v{raw.versao?.numero_versao} {raw.versao?.nome ? `· ${raw.versao.nome}` : ""}
              </Link>
            </dd>
          </dl>
        </div>

        {(transicoes.length > 0 ||
          (job.status === "aguardando_abertura" && podeAprovarRejeitar)) && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <Circle className="h-4 w-4 text-california-red" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">Status</h2>
            </div>
            {job.status === "aguardando_abertura" && podeAprovarRejeitar && (
              <div className="mb-4 pb-4 border-b border-border">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Aprovação financeira
                </p>
                <AprovarRejeitarButtons jobId={job.id} />
              </div>
            )}
            {transicoes.length > 0 && (
              <StatusActions jobId={job.id} transicoes={transicoes} />
            )}
          </div>
        )}
      </div>

      <JobRealizadoSection
        job={{
          id: job.id,
          status: job.status,
          projeto_id: job.projeto_id,
          orcamento_id: job.orcamento_id,
          versao_orcamento_aprovada_id: job.versao_orcamento_aprovada_id,
        }}
        versao={{
          id: versaoAprovada.id,
          numero_versao: versaoAprovada.numero_versao,
          nome: versaoAprovada.nome,
          moeda: versaoAprovada.moeda,
          percentual_honorarios: Number(versaoAprovada.percentual_honorarios),
          percentual_imposto: Number(versaoAprovada.percentual_imposto),
        }}
        grupos={grupos}
        itens={itens}
        realizadosMap={realizadosMap}
        editable={podeEditarRealizado}
      />
    </div>
  );
}
