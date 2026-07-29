import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FolderTree, Download } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  versaoStatusLabel,
  type VersaoOrcamento,
  type VersaoOrcamentoGrupo,
  type VersaoOrcamentoItem,
  type Categoria,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { GrupoCard } from "./grupo-card";
import { NovoGrupoDrawer } from "./novo-grupo-drawer";
import { TotaisCard } from "./totais-card";
import { VersaoEditorDrawer } from "./versao-editor-drawer";
import { AprovacaoActions } from "./aprovacao-actions";

export const dynamic = "force-dynamic";

function statusBadgeClasses(status: VersaoOrcamento["status"]): string {
  switch (status) {
    case "rascunho":
      return "bg-muted text-muted-foreground border-border";
    case "em_revisao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "enviada_cliente":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "aprovada":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "reprovada":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "substituida":
      return "bg-slate-100 text-slate-600 border-slate-200";
    case "cancelada":
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

export default async function VersaoDetailPage({
  params,
}: {
  params: { projetoId: string; orcId: string; versaoId: string };
}) {
  // TEMPORÁRIO: timing granular. Remover após diagnóstico.
  const t0 = Date.now();
  const session = await requireSession();
  const tSess = Date.now();
  const supabase = createClient();

  const [versaoRes, orcRes, gruposRes, itensRes, categoriasRes, jobsAtivosRes] = await Promise.all([
    supabase
      .from("versoes_orcamento")
      .select("*")
      .eq("id", params.versaoId)
      .eq("orcamento_id", params.orcId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<VersaoOrcamento>(),
    supabase
      .from("orcamentos")
      .select("id, codigo, nome, status")
      .eq("id", params.orcId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{ id: string; codigo: string; nome: string; status: string }>(),
    supabase
      .from("versoes_orcamento_grupos")
      .select("*")
      .eq("versao_orcamento_id", params.versaoId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .returns<VersaoOrcamentoGrupo[]>(),
    supabase
      .from("versoes_orcamento_itens")
      .select("*")
      .eq("versao_orcamento_id", params.versaoId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .returns<VersaoOrcamentoItem[]>(),
    supabase
      .from("categorias")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("nome", { ascending: true })
      .returns<Categoria[]>(),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("orcamento_id", params.orcId)
      .eq("tenant_id", session.activeTenant.id)
      .neq("status", "cancelado"),
  ]);

  const tQueries = Date.now();
  console.log(
    "[versao.detail.timing]",
    JSON.stringify({
      session: tSess - t0,
      parallel_queries: tQueries - tSess,
      total: tQueries - t0,
      itens: (itensRes.data ?? []).length,
    }),
  );

  if (versaoRes.error) console.error("[versao.detail]", versaoRes.error.message);
  if (gruposRes.error) console.error("[versao.grupos]", gruposRes.error.message);
  if (itensRes.error) console.error("[versao.itens]", itensRes.error.message);
  if (categoriasRes.error) console.error("[versao.categorias]", categoriasRes.error.message);

  const temJobAtivo = (jobsAtivosRes.count ?? 0) > 0;

  const versao = versaoRes.data;
  const orcamento = orcRes.data;
  if (!versao || !orcamento) notFound();

  const grupos = (gruposRes.data ?? []) as VersaoOrcamentoGrupo[];
  const categorias = (categoriasRes.data ?? []) as Categoria[];
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

  // Agrupa itens por grupo_id para passar para cada GrupoCard.
  const itensPorGrupo = new Map<string, VersaoOrcamentoItem[]>();
  for (const g of grupos) itensPorGrupo.set(g.id, []);
  for (const it of itens) {
    const list = itensPorGrupo.get(it.grupo_id);
    if (list) list.push(it);
  }

  const readOnly = versao.status === "aprovada" || versao.status === "cancelada";

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <Link
          href={`/orcamentos/${params.projetoId}/${orcamento.id}`}
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para {orcamento.codigo} · {orcamento.nome}
        </Link>

        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <p className="font-mono text-xs font-semibold text-muted-foreground">
            v{versao.numero_versao}
          </p>
          <h1 className="text-3xl font-bold tracking-tight">
            {versao.nome ?? `Versão ${versao.numero_versao}`}
          </h1>
          <Badge className={cn("border", statusBadgeClasses(versao.status))}>
            {versaoStatusLabel(versao.status)}
          </Badge>
          <VersaoEditorDrawer
            versao={versao}
            disabled={versao.status === "aprovada"}
            disabledReason={
              versao.status === "aprovada"
                ? "Versão aprovada não pode ser editada."
                : undefined
            }
          />
          <AprovacaoActions
            versaoId={versao.id}
            status={versao.status}
            temJobAtivo={temJobAtivo}
          />
          <a
            href={`/api/orcamentos/${params.projetoId}/${params.orcId}/versoes/${versao.id}/export`}
            title="Baixar planilha XLSX"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar
          </a>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            <span className="text-foreground/60">Moeda:</span>{" "}
            <span className="text-foreground font-medium">{versao.moeda}</span>
          </span>
          {Number(versao.taxa_cambio) !== 1 && (
            <>
              <span aria-hidden className="text-border">·</span>
              <span>
                <span className="text-foreground/60">Câmbio:</span>{" "}
                <span className="text-foreground font-medium">
                  {Number(versao.taxa_cambio)}
                </span>
              </span>
            </>
          )}
          <span aria-hidden className="text-border">·</span>
          <span>
            <span className="text-foreground/60">Honorários:</span>{" "}
            <span className="text-foreground font-medium">
              {Number(versao.percentual_honorarios).toString().replace(".", ",")}%
            </span>
          </span>
          <span aria-hidden className="text-border">·</span>
          <span>
            <span className="text-foreground/60">Impostos:</span>{" "}
            <span className="text-foreground font-medium">
              {Number(versao.percentual_imposto).toString().replace(".", ",")}%
            </span>
          </span>
        </div>
      </div>

      {/* Barra de ação — Novo grupo */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FolderTree className="h-4 w-4 text-california-red" />
          <span>
            {grupos.length} {grupos.length === 1 ? "grupo" : "grupos"} ·{" "}
            {itens.length} {itens.length === 1 ? "item" : "itens"} no total
          </span>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <NovoGrupoDrawer versaoId={versao.id} />
          </div>
        )}
      </div>

      {/* Grupos */}
      {grupos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
          <FolderTree className="h-10 w-10 text-muted-foreground/50 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">
            Nenhum grupo ainda. Crie o primeiro grupo para começar a adicionar itens.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Exemplos: Equipe, Ativação, Staff, Logística...
          </p>
        </div>
      ) : (
        // pr reserva a calha da trilha de ações (Remover), que fica
        // fora do frame de cada card, alinhada com as linhas da tabela.
        <div className={cn("space-y-4", !readOnly && "pr-12")}>
          {grupos.map((g) => (
            <GrupoCard
              key={g.id}
              grupo={g}
              itens={itensPorGrupo.get(g.id) ?? []}
              moeda={versao.moeda}
              readOnly={readOnly}
              categorias={categorias}
            />
          ))}
        </div>
      )}

      {/* Totais */}
      <TotaisCard
        grupos={grupos}
        itens={itens}
        percentualHonorarios={Number(versao.percentual_honorarios)}
        percentualImposto={Number(versao.percentual_imposto)}
        moeda={versao.moeda}
      />
    </div>
  );
}
