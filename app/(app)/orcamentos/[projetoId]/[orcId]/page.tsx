import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileStack, Lock } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import {
  orcamentoStatusLabel,
  type CategoriaDominio,
  type Orcamento,
  type Job,
  type Regional,
  type VersaoOrcamentoStatus,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { OrcamentoEditorDrawer } from "../orcamento-editor-drawer";
import { NovaVersaoDrawer } from "./versoes/nova-versao-drawer";
import { VersoesList, type VersaoRow } from "./versoes/versoes-list";
import { ImportarPlanilhaDrawer } from "./versoes/importar-drawer";
import { CriarJobDrawer } from "./criar-job-drawer";

export const dynamic = "force-dynamic";

function statusBadgeClasses(status: Orcamento["status"]): string {
  switch (status) {
    case "rascunho":
      return "bg-muted text-muted-foreground border-border";
    case "em_revisao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "enviado_cliente":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "aprovado":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "job_criado":
      return "bg-california-red/10 text-california-red border-california-red/20";
    case "recusado":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "cancelado":
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export default async function OrcamentoDetailPage({
  params,
}: {
  params: { projetoId: string; orcId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const [orcRes, projRes, responsaveis, versoesRes, categoriasOrcRes, regionaisRes, jobsProjetoRes] = await Promise.all([
    supabase
      .from("orcamentos")
      .select("id, tenant_id, projeto_id, codigo, nome, status, categoria_id, data_inicio_prevista, data_fim_prevista, versao_aprovada_id, created_by, created_at, updated_at, categoria:categorias_dominio(nome)")
      .eq("id", params.orcId)
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("projetos")
      .select("id, codigo, nome, campanha, cliente:clientes(id, nome_fantasia), responsavel:profiles!responsavel_id(id, nome)")
      .eq("id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    listActiveMembers(session.activeTenant.id),
    supabase
      .from("versoes_orcamento")
      .select("id, numero_versao, nome, status, percentual_honorarios, percentual_imposto, moeda, created_at")
      .eq("orcamento_id", params.orcId)
      .eq("tenant_id", session.activeTenant.id)
      .order("numero_versao", { ascending: false }),
    supabase
      .from("categorias_dominio")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo", "orcamento")
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("jobs")
      .select("id, codigo, nome, job_pai_id, orcamento_id, status")
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .neq("status", "cancelado"),
  ]);

  if (orcRes.error) console.error("[orcamentos.detail]", orcRes.error.message);
  if (projRes.error) console.error("[projetos.detail]", projRes.error.message);

  const orcamentoRaw = orcRes.data as any;
  const projeto = projRes.data as any;
  if (!orcamentoRaw || !projeto) notFound();

  const orcamento = orcamentoRaw as Orcamento;
  const orcamentoCategoriaNome: string | null = orcamentoRaw.categoria?.nome ?? null;
  const clienteNome: string | null = projeto.cliente?.nome_fantasia ?? null;
  const responsavelNome: string | null = projeto.responsavel?.nome ?? null;
  const categoriasOrcamento = (categoriasOrcRes.data ?? []) as Pick<CategoriaDominio, "id" | "nome">[];

  const regionais = (regionaisRes.data ?? []) as Pick<Regional, "id" | "nome">[];
  const jobsAtivosDoProjeto = (jobsProjetoRes.data ?? []) as Pick<Job, "id" | "codigo" | "nome" | "job_pai_id">[];
  const jobDoOrcamento = (jobsProjetoRes.data ?? []).find((j: any) => j.orcamento_id === orcamento.id);

  if (versoesRes.error) console.error("[versoes.list]", versoesRes.error.message);
  const versoesBrutas = (versoesRes.data ?? []) as any[];
  const versaoIds = versoesBrutas.map((v) => v.id);

  const agregadoPorVersao = new Map<string, { count: number; total: number }>();
  if (versaoIds.length > 0) {
    const { data: itensBrutos, error: itensAggErr } = await supabase
      .from("versoes_orcamento_itens")
      .select("versao_orcamento_id, total_orcado")
      .in("versao_orcamento_id", versaoIds)
      .eq("tenant_id", session.activeTenant.id);

    if (itensAggErr) console.error("[versoes.agg]", itensAggErr.message);
    for (const it of (itensBrutos ?? []) as any[]) {
      const cur = agregadoPorVersao.get(it.versao_orcamento_id) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(it.total_orcado ?? 0);
      agregadoPorVersao.set(it.versao_orcamento_id, cur);
    }
  }

  // Calcular valor de faturamento da versão aprovada para pré-preencher o drawer de criar job
  let valorFaturamento = 0;
  if (orcamento.status === "aprovado" && orcamento.versao_aprovada_id) {
    const versaoAprovada = versoesBrutas.find(
      (v) => v.id === orcamento.versao_aprovada_id,
    );
    if (versaoAprovada) {
      const agg = agregadoPorVersao.get(versaoAprovada.id) ?? { count: 0, total: 0 };
      const perc_honor = Number(versaoAprovada.percentual_honorarios ?? 0) / 100;
      const perc_imp = Number(versaoAprovada.percentual_imposto ?? 0) / 100;
      const bruto = agg.total * (1 + perc_honor);
      valorFaturamento = perc_imp > 0 && perc_imp < 1 ? bruto / (1 - perc_imp) : bruto;
    }
  }

  const versoes: VersaoRow[] = versoesBrutas.map((v) => {
    const agg = agregadoPorVersao.get(v.id) ?? { count: 0, total: 0 };
    return {
      id: v.id,
      numero_versao: v.numero_versao,
      nome: v.nome,
      status: v.status as VersaoOrcamentoStatus,
      percentual_honorarios: Number(v.percentual_honorarios ?? 0),
      percentual_imposto: Number(v.percentual_imposto ?? 0),
      moeda: v.moeda ?? "BRL",
      itens_count: agg.count,
      itens_total: agg.total,
      created_at: v.created_at,
    };
  });

  const protegido = orcamento.status === "aprovado" || orcamento.status === "job_criado";
  const podeCriarVersao = orcamento.status !== "job_criado" && orcamento.status !== "cancelado";

  const periodo =
    orcamento.data_inicio_prevista || orcamento.data_fim_prevista
      ? `${formatDate(orcamento.data_inicio_prevista)} → ${formatDate(orcamento.data_fim_prevista)}`
      : null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <Link
          href={`/orcamentos/${params.projetoId}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para {projeto.codigo} · {projeto.nome}
        </Link>

        <div className="mt-3">
          <p className="font-mono text-xs font-semibold text-muted-foreground">
            {orcamento.codigo}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{orcamento.nome}</h1>
            <Badge className={cn("border", statusBadgeClasses(orcamento.status))}>
              {orcamentoStatusLabel(orcamento.status)}
            </Badge>
            <OrcamentoEditorDrawer
              projetoId={params.projetoId}
              orcamento={orcamento}
              categorias={categoriasOrcamento}
              disabled={protegido}
              disabledReason={
                protegido
                  ? `Bloqueado em ${orcamentoStatusLabel(orcamento.status).toLowerCase()} — alterações via fluxo de aprovação/job.`
                  : undefined
              }
            />
            {orcamento.status === "aprovado" && !jobDoOrcamento && (
              <CriarJobDrawer
                orcamentoId={orcamento.id}
                clienteNome={clienteNome ?? "—"}
                jobsAtivosDoProjeto={jobsAtivosDoProjeto}
                regionais={regionais}
                responsaveis={responsaveis}
                responsavelDefaultId={(projeto.responsavel as any)?.id ?? ""}
                valorFaturamento={valorFaturamento}
              />
            )}
            {orcamento.status === "job_criado" && jobDoOrcamento && (
              <Link
                href={`/jobs/${(jobDoOrcamento as any).id}`}
                prefetch={false}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
              >
                Ver job {(jobDoOrcamento as any).codigo}
              </Link>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>
              <span className="text-foreground/60">Cliente:</span>{" "}
              <span className="text-foreground font-medium">{clienteNome ?? "—"}</span>
            </span>
            <span aria-hidden className="text-border">·</span>
            <span>
              <span className="text-foreground/60">Responsável:</span>{" "}
              <span className="text-foreground font-medium">{responsavelNome ?? "—"}</span>
            </span>
            {periodo && (
              <>
                <span aria-hidden className="text-border">·</span>
                <span>
                  <span className="text-foreground/60">Período:</span>{" "}
                  <span className="text-foreground font-medium">{periodo}</span>
                </span>
              </>
            )}
            {projeto.campanha && (
              <>
                <span aria-hidden className="text-border">·</span>
                <span>
                  <span className="text-foreground/60">Campanha:</span>{" "}
                  <span className="text-foreground font-medium">{projeto.campanha}</span>
                </span>
              </>
            )}
            {orcamentoCategoriaNome && (
              <>
                <span aria-hidden className="text-border">·</span>
                <span>
                  <span className="text-foreground/60">Categoria:</span>{" "}
                  <span className="text-foreground font-medium">{orcamentoCategoriaNome}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {protegido && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 flex items-start gap-3">
          <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            Este orçamento está em estado protegido (
            <strong className="text-foreground">{orcamentoStatusLabel(orcamento.status)}</strong>
            ). A edição dos dados ficou bloqueada.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <div className="flex items-center justify-between border-b border-border p-6">
          <div className="flex items-center gap-2">
            <FileStack className="h-5 w-5 text-california-red" />
            <div>
              <h2 className="text-lg font-semibold leading-none tracking-tight">
                Versões do orçamento
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                v1, v2, v3… clique para abrir e gerenciar os itens.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ImportarPlanilhaDrawer
              projetoId={params.projetoId}
              orcamentoId={orcamento.id}
              disabled={!podeCriarVersao}
              disabledReason={
                podeCriarVersao
                  ? undefined
                  : `Orçamento ${orcamentoStatusLabel(orcamento.status).toLowerCase()} não aceita novas versões.`
              }
            />
            <NovaVersaoDrawer
              orcamentoId={orcamento.id}
              disabled={!podeCriarVersao}
              disabledReason={
                podeCriarVersao
                  ? undefined
                  : `Orçamento ${orcamentoStatusLabel(orcamento.status).toLowerCase()} não aceita novas versões.`
              }
            />
          </div>
        </div>

        {versoes.length === 0 ? (
          <div className="p-6">
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
              <FileStack className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nenhuma versão ainda.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Clique em <span className="font-semibold text-foreground">Nova versão</span> para começar.
              </p>
            </div>
          </div>
        ) : (
          <VersoesList
            projetoId={params.projetoId}
            orcamentoId={orcamento.id}
            versoes={versoes}
            podeAprovarVersao={
              orcamento.status !== "aprovado" &&
              orcamento.status !== "job_criado" &&
              orcamento.status !== "cancelado"
            }
          />
        )}
      </div>
    </div>
  );
}
