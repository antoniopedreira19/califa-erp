import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Lock, Table2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type {
  Categoria,
  ItemBv,
  ItemPlanilhaJob,
  JobItemRealizado,
  VersaoOrcamentoGrupo,
} from "@/lib/types";
import { PlanilhaConferencia } from "./planilha-conferencia";

export const dynamic = "force-dynamic";

/**
 * Item 03 do protótipo "Abertura de Job — Financeiro": a planilha interna
 * do job, em leitura, DENTRO do fluxo de abertura — quem confere volta
 * para o formulário sem perder o caminho.
 *
 * É a mesma planilha da aba Planilha Interna do job (mesmos componentes,
 * mesmos agrupamentos, tipos, colunas e totais), com as ações desligadas
 * (`podeAcoes` em `false`) — e, desde 21/08/2026, com a chave Bruto ⇄
 * Líquido, porque é AQUI que o planejado congela: o financeiro precisa
 * ver o custo sem a comissão antes de assinar embaixo.
 */
export default async function PlanilhaDaAberturaPage({
  params,
}: {
  params: { jobId: string };
}) {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  const { data: raw, error } = await supabase
    .from("jobs")
    .select(
      "id, codigo, nome, status, empresa_id, responsavel_id, versao_orcamento_aprovada_id, " +
        "versao:versoes_orcamento!versao_orcamento_aprovada_id(id, numero_versao, moeda, percentual_honorarios, percentual_imposto)",
    )
    .eq("id", params.jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (error) console.error("[abertura-job.planilha]", error.message);
  if (!raw) notFound();

  // Job que já saiu da fila tem a planilha na página dele — esta rota
  // existe só como passo do fluxo de abertura.
  if ((raw as any).status !== "aguardando_abertura") {
    redirect(`/jobs/${params.jobId}?from=financeiro&aba=planilha`);
  }

  const versao = (raw as any).versao;
  const versaoAprovadaId = (raw as any).versao_orcamento_aprovada_id as string;

  const [gruposRes, itensRes, realizadosRes, categoriasRes, bvsRes] =
    await Promise.all([
    supabase
      .from("versoes_orcamento_grupos")
      .select("*")
      .eq("versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .returns<VersaoOrcamentoGrupo[]>(),
    // Orçado vem da CÓPIA do job, como na aba do job: a errata altera a
    // cópia e a versão aprovada continua sendo o que o cliente aprovou.
    supabase
      .from("jobs_itens_orcado")
      .select("*")
      .eq("job_id", params.jobId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true }),
    // O realizado já pode ter sido lançado antes da abertura desde
    // 17/08/2026 — se houver, o financeiro precisa vê-lo aqui.
    supabase
      .from("jobs_itens_realizado")
      .select("*")
      .eq("job_id", params.jobId)
      .eq("tenant_id", session.activeTenant.id)
      .returns<JobItemRealizado[]>(),
    supabase
      .from("categorias")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .returns<Pick<Categoria, "id" | "nome">[]>(),
    // O BV nasce no ORÇAMENTO, antes da aprovação — então um job na fila
    // de abertura já pode ter BV lançado. Esta tela o ignorava, e com
    // isso mostrava ao financeiro um planejado com a comissão embutida.
    supabase
      .from("itens_bv")
      .select(
        "id, tenant_id, item_versao_id, fornecedor_id, valor, prazo_repasse, " +
          "situacao, created_by, created_at, updated_at, " +
          "item:versoes_orcamento_itens!inner(versao_orcamento_id)",
      )
      .eq("item.versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", session.activeTenant.id)
      .neq("situacao", "cancelado"),
  ]);

  for (const [rotulo, res] of [
    ["grupos", gruposRes],
    ["itens", itensRes],
    ["realizado", realizadosRes],
    ["categorias", categoriasRes],
    ["bvs", bvsRes],
  ] as const) {
    if (res.error) {
      console.error(`[abertura-job.planilha.${rotulo}]`, res.error.message);
    }
  }

  const grupos = gruposRes.data ?? [];

  const itens: ItemPlanilhaJob[] = (itensRes.data ?? []).map((it: any) => ({
    id: it.item_versao_id,
    orcado_id: it.id,
    grupo_id: it.grupo_id,
    ordem: Number(it.ordem ?? 0),
    item: it.item,
    tipo_custo: it.tipo_custo,
    categoria_id: it.categoria_id ?? null,
    valor_unitario_orcado: Number(it.valor_unitario_orcado ?? 0),
    quantidade_orcada: Number(it.quantidade_orcada ?? 1),
    dias_meses_orcado: Number(it.dias_meses_orcado ?? 1),
    total_orcado: Number(it.total_orcado ?? 0),
    valor_unitario_planejado: Number(it.valor_unitario_planejado ?? 0),
    quantidade_planejada: Number(it.quantidade_planejada ?? 0),
    dias_meses_planejado: Number(it.dias_meses_planejado ?? 0),
    total_planejado: Number(it.total_planejado ?? 0),
    // `null` preservado de propósito: significa "ainda não congelado", e
    // é o que manda a conta calcular a dedução a partir do BV vigente.
    em_save: it.em_save === true,
    save_consumido: Number(it.save_consumido ?? 0),
    bv_liquido_planejado:
      it.bv_liquido_planejado === null || it.bv_liquido_planejado === undefined
        ? null
        : Number(it.bv_liquido_planejado),
  }));

  const realizadosMap = new Map<string, JobItemRealizado>();
  for (const r of (realizadosRes.data ?? []) as any[]) {
    realizadosMap.set(r.item_id, {
      ...r,
      valor_unitario_realizado: Number(r.valor_unitario_realizado ?? 0),
      quantidade_realizada: Number(r.quantidade_realizada ?? 0),
      dias_meses_realizado: Number(r.dias_meses_realizado ?? 0),
      total_realizado: Number(r.total_realizado ?? 0),
    } as JobItemRealizado);
  }

  const categoriasMap = new Map<string, string>();
  for (const c of categoriasRes.data ?? []) categoriasMap.set(c.id, c.nome);

  // Objeto, e não Map: só objeto atravessa a fronteira server → client
  // sem cerimônia, e é o formato que a planilha do job já espera.
  const bvsPorItem: Record<string, ItemBv> = {};
  for (const linha of (bvsRes.data ?? []) as any[]) {
    const { item: _joinFiltro, ...bv } = linha;
    bvsPorItem[bv.item_versao_id] = { ...bv, valor: Number(bv.valor ?? 0) };
  }

  const itensPorGrupo = new Map<string, ItemPlanilhaJob[]>();
  for (const g of grupos) itensPorGrupo.set(g.id, []);
  for (const it of itens) itensPorGrupo.get(it.grupo_id)?.push(it);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/financeiro/abertura-de-job/${params.jobId}`}
          prefetch={false}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3.5 py-2 text-[12.5px] font-semibold transition-colors hover:border-[#d7d7d7]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para a abertura
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <Table2 className="h-4 w-4 text-california-red" />
          <h1 className="text-base font-bold tracking-tight">
            Planilha interna
          </h1>
          <span className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs font-bold">
            {(raw as any).codigo}
          </span>
          <span className="text-[13px] text-muted-foreground">
            {(raw as any).nome}
          </span>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-[11px] font-semibold text-muted-foreground">
          <Lock className="h-3 w-3" />
          Somente leitura
        </span>
      </div>

      <PlanilhaConferencia
        jobId={(raw as any).id}
        jobEmpresaId={(raw as any).empresa_id ?? ""}
        jobResponsavelId={(raw as any).responsavel_id ?? ""}
        grupos={grupos}
        itens={itens}
        itensPorGrupo={itensPorGrupo}
        realizadosMap={realizadosMap}
        categoriasMap={categoriasMap}
        bvsPorItem={bvsPorItem}
        versaoLabel={`v${versao?.numero_versao ?? 1}`}
        moeda={versao?.moeda ?? "BRL"}
        percentualHonorarios={Number(versao?.percentual_honorarios ?? 0)}
        percentualImposto={Number(versao?.percentual_imposto ?? 0)}
      />
    </div>
  );
}
