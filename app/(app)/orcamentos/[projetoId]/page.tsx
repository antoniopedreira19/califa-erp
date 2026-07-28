import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import type { Cliente, Orcamento, Projeto } from "@/lib/types";
import { projetoStatusLabel } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ProjetoEditorDrawer } from "../projeto-editor-drawer";
import { OrcamentosList, type OrcamentoRow } from "./orcamentos-list";

export const dynamic = "force-dynamic";

function projetoBadgeClasses(status: Projeto["status"]): string {
  return status === "ativo"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-slate-100 text-slate-500 border-slate-200";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export default async function ProjetoDetailPage({
  params,
}: {
  params: { projetoId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const [projRes, orcsRes, clientesRes, responsaveis] = await Promise.all([
    supabase
      .from("projetos")
      .select(
        "id, tenant_id, codigo, nome, campanha, status, cliente_id, responsavel_id, data_inicio_prevista, created_by, created_at, updated_at, cliente:clientes(id, nome_fantasia), responsavel:profiles!responsavel_id(id, nome)",
      )
      .eq("id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("orcamentos")
      .select("id, codigo, nome, tipo, status, data_fim_prevista, created_at")
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("clientes")
      .select("id, nome_fantasia, codigo_curto")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    listActiveMembers(session.activeTenant.id),
  ]);

  if (projRes.error) console.error("[projeto.detail]", projRes.error.message);
  const raw = projRes.data as any;
  if (!raw) notFound();

  const projeto: Projeto = {
    id: raw.id,
    tenant_id: raw.tenant_id,
    codigo: raw.codigo,
    nome: raw.nome,
    campanha: raw.campanha,
    status: raw.status,
    cliente_id: raw.cliente_id,
    responsavel_id: raw.responsavel_id,
    data_inicio_prevista: raw.data_inicio_prevista,
    created_by: raw.created_by,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
  const clienteNome: string | null = raw.cliente?.nome_fantasia ?? null;
  const responsavelNome: string | null = raw.responsavel?.nome ?? null;

  const orcamentosBrutos = (orcsRes.data ?? []) as any[];
  const orcamentoIds = orcamentosBrutos.map((o) => o.id);

  // Contagem agregada de versões por orçamento
  const versoesCountMap = new Map<string, number>();
  if (orcamentoIds.length > 0) {
    const { data: versoes } = await supabase
      .from("versoes_orcamento")
      .select("orcamento_id")
      .in("orcamento_id", orcamentoIds)
      .eq("tenant_id", session.activeTenant.id);
    for (const v of ((versoes ?? []) as any[])) {
      versoesCountMap.set(v.orcamento_id, (versoesCountMap.get(v.orcamento_id) ?? 0) + 1);
    }
  }

  const orcamentos: OrcamentoRow[] = orcamentosBrutos.map((o) => ({
    id: o.id,
    codigo: o.codigo,
    nome: o.nome,
    tipo: o.tipo,
    status: o.status as Orcamento["status"],
    data_fim_prevista: o.data_fim_prevista,
    versoes_count: versoesCountMap.get(o.id) ?? 0,
    created_at: o.created_at,
  }));

  const clientes = (clientesRes.data ?? []) as Pick<
    Cliente,
    "id" | "nome_fantasia" | "codigo_curto"
  >[];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <Link
          href="/orcamentos"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para projetos
        </Link>

        <div className="mt-3">
          <p className="font-mono text-xs font-semibold text-muted-foreground">
            {projeto.codigo}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{projeto.nome}</h1>
            <Badge className={cn("border", projetoBadgeClasses(projeto.status))}>
              {projetoStatusLabel(projeto.status)}
            </Badge>
            <ProjetoEditorDrawer
              projeto={projeto}
              clientes={clientes}
              responsaveis={responsaveis}
            />
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
            <span aria-hidden className="text-border">·</span>
            <span>
              <span className="text-foreground/60">Início previsto:</span>{" "}
              <span className="text-foreground font-medium">{formatDate(projeto.data_inicio_prevista)}</span>
            </span>
            {projeto.campanha && (
              <>
                <span aria-hidden className="text-border">·</span>
                <span>
                  <span className="text-foreground/60">Campanha:</span>{" "}
                  <span className="text-foreground font-medium">{projeto.campanha}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <div className="flex items-center justify-between border-b border-border p-6">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-california-red" />
            <div>
              <h2 className="text-lg font-semibold leading-none tracking-tight">
                Orçamentos do projeto
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Cada orçamento corresponde a um entregável (peça) e gera um job próprio quando aprovado.
              </p>
            </div>
          </div>
          <Link
            href={`/orcamentos/${projeto.id}/novo`}
            prefetch={false}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover transition-all"
          >
            <Plus className="h-4 w-4" />
            Novo orçamento
          </Link>
        </div>
        <div className="p-6">
          <OrcamentosList projetoId={projeto.id} orcamentos={orcamentos} />
        </div>
      </div>
    </div>
  );
}
