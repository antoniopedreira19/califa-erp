"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { versaoSchema } from "@/lib/validations/versoes";
import { itemSchema } from "@/lib/validations/itens";
import { grupoSchema } from "@/lib/validations/grupos";
import { categoriaSchema } from "@/lib/validations/categorias";
import type {
  VersaoOrcamento,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
} from "@/lib/types";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

// ============================================================
// VERSÕES
// ============================================================

function extractVersaoInput(formData: FormData) {
  // Empty string dos numéricos → Zod aplica default na criação.
  const get = (k: string, fallback: string) => {
    const raw = formData.get(k)?.toString() ?? "";
    return raw.trim().length > 0 ? raw : fallback;
  };
  return {
    nome: formData.get("nome")?.toString() ?? "",
    moeda: get("moeda", "BRL"),
    taxa_cambio: get("taxa_cambio", "1"),
    percentual_honorarios: get("percentual_honorarios", "0"),
    percentual_imposto: get("percentual_imposto", "0"),
    status: (formData.get("status")?.toString() ?? "rascunho") as any,
  };
}

/** Extrai apenas os campos que o usuário efetivamente preencheu no edit.
 *  Campos vazios preservam o valor atual no banco. */
function extractVersaoPartial(formData: FormData): Record<string, unknown> {
  const partial: Record<string, unknown> = {};

  // nome: sempre presente no form; vazio significa "sem nome" (null).
  const nome = formData.get("nome")?.toString() ?? "";
  partial.nome = nome.trim().length > 0 ? nome.trim() : null;

  const moeda = formData.get("moeda")?.toString().trim();
  if (moeda && moeda.length > 0) {
    partial.moeda = moeda.toUpperCase().slice(0, 3);
  }

  const taxa = formData.get("taxa_cambio")?.toString().trim();
  if (taxa && taxa.length > 0) {
    const n = Number(taxa);
    if (Number.isFinite(n) && n > 0) partial.taxa_cambio = n;
  }

  const honor = formData.get("percentual_honorarios")?.toString().trim();
  if (honor && honor.length > 0) {
    const n = Number(honor);
    if (Number.isFinite(n) && n >= 0 && n <= 100)
      partial.percentual_honorarios = n;
  }

  const imp = formData.get("percentual_imposto")?.toString().trim();
  if (imp && imp.length > 0) {
    const n = Number(imp);
    if (Number.isFinite(n) && n >= 0 && n <= 100)
      partial.percentual_imposto = n;
  }

  const status = formData.get("status")?.toString();
  if (status) partial.status = status;

  return partial;
}

async function proximoNumeroVersao(
  orcamentoId: string,
  tenantId: string,
): Promise<number> {
  const supabase = createClient();
  const { data } = await supabase
    .from("versoes_orcamento")
    .select("numero_versao")
    .eq("orcamento_id", orcamentoId)
    .eq("tenant_id", tenantId)
    .order("numero_versao", { ascending: false })
    .limit(1)
    .maybeSingle<{ numero_versao: number }>();
  return (data?.numero_versao ?? 0) + 1;
}

function mapVersaoDbError(msg: string): string {
  if (msg.includes("uniq_versao_numero_por_orcamento")) {
    return "Já existe uma versão com esse número.";
  }
  if (msg.includes("uniq_versao_aprovada_por_orcamento")) {
    return "Já existe uma versão aprovada neste orçamento.";
  }
  if (msg.includes("percentuais_validos")) {
    return "Percentuais precisam estar entre 0 e 100.";
  }
  if (msg.includes("taxa_positiva")) {
    return "Taxa de câmbio precisa ser maior que zero.";
  }
  return "Não foi possível salvar a versão.";
}

export async function criarVersao(
  orcamentoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = versaoSchema.safeParse(extractVersaoInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const { data: orc } = await supabase
    .from("orcamentos")
    .select("id, status")
    .eq("id", orcamentoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: string }>();

  if (!orc) return { ok: false, message: "Orçamento não encontrado." };
  if (orc.status === "job_criado" || orc.status === "cancelado") {
    return {
      ok: false,
      message: `Não é possível criar versão em orçamento ${orc.status}.`,
    };
  }

  const numero = await proximoNumeroVersao(orcamentoId, session.activeTenant.id);

  const { data, error } = await supabase
    .from("versoes_orcamento")
    .insert({
      ...parsed.data,
      tenant_id: session.activeTenant.id,
      orcamento_id: orcamentoId,
      numero_versao: numero,
      created_by: session.profile.id,
    })
    .select("id, numero_versao")
    .single();

  if (error) {
    console.error("[versoes.criar]", error.message);
    return { ok: false, message: mapVersaoDbError(error.message) };
  }

  await logAuditEvent({
    acao: "versao_orcamento.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: data.id,
    metadata: { orcamento_id: orcamentoId, numero_versao: data.numero_versao },
  });

  revalidatePath(`/orcamentos/${orcamentoId}`);
  redirect(`/orcamentos/${orcamentoId}/versoes/${data.id}`);
}

export async function atualizarVersao(
  versaoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const updates = extractVersaoPartial(formData);

  const supabase = createClient();

  const { data: atual } = await supabase
    .from("versoes_orcamento")
    .select("orcamento_id, status")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ orcamento_id: string; status: string }>();

  if (!atual) return { ok: false, message: "Versão não encontrada." };
  if (atual.status === "aprovada") {
    return {
      ok: false,
      message: "Versão aprovada não pode ser alterada manualmente.",
    };
  }

  const { error } = await supabase
    .from("versoes_orcamento")
    .update(updates)
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[versoes.atualizar]", error.message);
    return { ok: false, message: mapVersaoDbError(error.message) };
  }

  await logAuditEvent({
    acao: "versao_orcamento.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
  });

  revalidatePath(`/orcamentos/${atual.orcamento_id}`);
  revalidatePath(`/orcamentos/${atual.orcamento_id}/versoes/${versaoId}`);
  return { ok: true, id: versaoId };
}

export async function duplicarVersao(versaoId: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: original } = await supabase
    .from("versoes_orcamento")
    .select("*")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<VersaoOrcamento>();

  if (!original) return { ok: false, message: "Versão original não encontrada." };

  const numero = await proximoNumeroVersao(
    original.orcamento_id,
    session.activeTenant.id,
  );

  const { data: nova, error } = await supabase
    .from("versoes_orcamento")
    .insert({
      tenant_id: session.activeTenant.id,
      orcamento_id: original.orcamento_id,
      numero_versao: numero,
      nome: original.nome ? `${original.nome} (cópia)` : null,
      status: "rascunho",
      moeda: original.moeda,
      taxa_cambio: original.taxa_cambio,
      percentual_honorarios: original.percentual_honorarios,
      percentual_imposto: original.percentual_imposto,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error || !nova) {
    console.error("[versoes.duplicar]", error?.message);
    return { ok: false, message: mapVersaoDbError(error?.message ?? "") };
  }

  // Duplica grupos e mapeia old_id → new_id pra reatribuir os itens.
  const { data: gruposOriginais } = await supabase
    .from("versoes_orcamento_grupos")
    .select("id, nome, ordem")
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .order("ordem");

  const grupoMap = new Map<string, string>();
  if (gruposOriginais && gruposOriginais.length > 0) {
    const gruposRows = gruposOriginais.map((g: any) => ({
      tenant_id: session.activeTenant.id,
      versao_orcamento_id: nova.id,
      nome: g.nome,
      ordem: g.ordem,
    }));
    const { data: novosGrupos, error: gErr } = await supabase
      .from("versoes_orcamento_grupos")
      .insert(gruposRows)
      .select("id, nome, ordem");
    if (gErr) {
      console.error("[versoes.duplicar.grupos]", gErr.message);
    } else if (novosGrupos) {
      // Associação por (nome, ordem) — combinação única na versão nova.
      for (const orig of gruposOriginais as any[]) {
        const novo = novosGrupos.find(
          (g: any) => g.nome === orig.nome && g.ordem === orig.ordem,
        );
        if (novo) grupoMap.set(orig.id, novo.id);
      }
    }
  }

  const { data: itens } = await supabase
    .from("versoes_orcamento_itens")
    .select(
      "ordem, grupo_id, planilha_origem, item, tipo_custo, valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, fornecedor_id, observacoes",
    )
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (itens && itens.length > 0) {
    const rows = itens
      .map((i: any) => {
        const novoGrupoId = grupoMap.get(i.grupo_id);
        if (!novoGrupoId) return null;
        return {
          ...i,
          tenant_id: session.activeTenant.id,
          versao_orcamento_id: nova.id,
          grupo_id: novoGrupoId,
        };
      })
      .filter((r): r is any => r !== null);

    if (rows.length > 0) {
      const { error: itensErr } = await supabase
        .from("versoes_orcamento_itens")
        .insert(rows);
      if (itensErr) {
        console.error("[versoes.duplicar.itens]", itensErr.message);
      }
    }
  }

  await logAuditEvent({
    acao: "versao_orcamento.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: nova.id,
    metadata: {
      orcamento_id: original.orcamento_id,
      numero_versao: numero,
      duplicada_de: versaoId,
    },
  });

  revalidatePath(`/orcamentos/${original.orcamento_id}`);
  redirect(`/orcamentos/${original.orcamento_id}/versoes/${nova.id}`);
}

export async function cancelarVersao(versaoId: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: atual } = await supabase
    .from("versoes_orcamento")
    .select("orcamento_id, status")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ orcamento_id: string; status: string }>();

  if (!atual) return { ok: false, message: "Versão não encontrada." };
  if (atual.status === "aprovada") {
    return { ok: false, message: "Versão aprovada não pode ser cancelada." };
  }

  const { error } = await supabase
    .from("versoes_orcamento")
    .update({ status: "cancelada" })
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[versoes.cancelar]", error.message);
    return { ok: false, message: "Não foi possível cancelar." };
  }

  await logAuditEvent({
    acao: "versao_orcamento.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: { acao: "cancelada" },
  });

  revalidatePath(`/orcamentos/${atual.orcamento_id}`);
  return { ok: true, id: versaoId };
}

// ============================================================
// GRUPOS
// ============================================================

async function loadVersaoParaGrupo(
  versaoId: string,
  tenantId: string,
): Promise<{ orcamento_id: string; status: string } | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("versoes_orcamento")
    .select("orcamento_id, status")
    .eq("id", versaoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ orcamento_id: string; status: string }>();
  return data ?? null;
}

async function proximaOrdemGrupo(
  versaoId: string,
  tenantId: string,
): Promise<number> {
  const supabase = createClient();
  const { data } = await supabase
    .from("versoes_orcamento_grupos")
    .select("ordem")
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", tenantId)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle<{ ordem: number }>();
  return (data?.ordem ?? 0) + 1;
}

function mapGrupoDbError(msg: string): string {
  if (msg.includes("uniq_grupo_nome_por_versao")) {
    return "Já existe um grupo com esse nome nesta versão.";
  }
  if (msg.includes("grupos_nome_nao_vazio")) {
    return "Nome do grupo não pode ficar vazio.";
  }
  return "Não foi possível salvar o grupo.";
}

export async function criarGrupo(
  versaoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = grupoSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Nome inválido.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const versao = await loadVersaoParaGrupo(versaoId, session.activeTenant.id);
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada") {
    return {
      ok: false,
      message: "Versão aprovada não aceita novos grupos.",
    };
  }

  const supabase = createClient();
  const ordem = await proximaOrdemGrupo(versaoId, session.activeTenant.id);

  const { data, error } = await supabase
    .from("versoes_orcamento_grupos")
    .insert({
      tenant_id: session.activeTenant.id,
      versao_orcamento_id: versaoId,
      nome: parsed.data.nome,
      ordem,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[grupos.criar]", error.message);
    return { ok: false, message: mapGrupoDbError(error.message) };
  }

  revalidatePath(`/orcamentos/${versao.orcamento_id}/versoes/${versaoId}`);
  return { ok: true, id: data.id };
}

export async function renomearGrupo(
  grupoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = grupoSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Nome inválido.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data: grupo } = await supabase
    .from("versoes_orcamento_grupos")
    .select("versao_orcamento_id")
    .eq("id", grupoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Pick<VersaoOrcamentoGrupo, "versao_orcamento_id">>();

  if (!grupo) return { ok: false, message: "Grupo não encontrado." };

  const versao = await loadVersaoParaGrupo(
    grupo.versao_orcamento_id,
    session.activeTenant.id,
  );
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada") {
    return { ok: false, message: "Versão aprovada não permite renomear grupo." };
  }

  const { error } = await supabase
    .from("versoes_orcamento_grupos")
    .update({ nome: parsed.data.nome })
    .eq("id", grupoId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[grupos.renomear]", error.message);
    return { ok: false, message: mapGrupoDbError(error.message) };
  }

  revalidatePath(
    `/orcamentos/${versao.orcamento_id}/versoes/${grupo.versao_orcamento_id}`,
  );
  return { ok: true, id: grupoId };
}

export async function removerGrupo(grupoId: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: grupo } = await supabase
    .from("versoes_orcamento_grupos")
    .select("versao_orcamento_id")
    .eq("id", grupoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Pick<VersaoOrcamentoGrupo, "versao_orcamento_id">>();

  if (!grupo) return { ok: false, message: "Grupo não encontrado." };

  const versao = await loadVersaoParaGrupo(
    grupo.versao_orcamento_id,
    session.activeTenant.id,
  );
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada") {
    return { ok: false, message: "Versão aprovada não permite remover grupo." };
  }

  const supabase2 = createClient();
  const { count } = await supabase2
    .from("versoes_orcamento_itens")
    .select("id", { count: "exact", head: true })
    .eq("grupo_id", grupoId)
    .eq("tenant_id", session.activeTenant.id);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: `Remova os ${count} ${count === 1 ? "item" : "itens"} do grupo antes de excluí-lo.`,
    };
  }

  const { error } = await supabase
    .from("versoes_orcamento_grupos")
    .delete()
    .eq("id", grupoId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[grupos.remover]", error.message);
    return { ok: false, message: "Não foi possível remover o grupo." };
  }

  revalidatePath(
    `/orcamentos/${versao.orcamento_id}/versoes/${grupo.versao_orcamento_id}`,
  );
  return { ok: true, id: grupoId };
}

// ============================================================
// CATEGORIAS (mesmo padrão de GRUPOS)
// ============================================================

function mapCategoriaDbError(msg: string): string {
  if (msg.includes("uniq_categoria_nome_por_versao")) {
    return "Já existe uma categoria com esse nome nesta versão.";
  }
  if (msg.includes("categorias_nome_nao_vazio")) {
    return "Nome da categoria não pode ficar vazio.";
  }
  return "Não foi possível salvar a categoria.";
}

export async function criarCategoria(
  versaoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = categoriaSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Nome inválido.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const versao = await loadVersaoParaGrupo(versaoId, session.activeTenant.id);
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada") {
    return {
      ok: false,
      message: "Versão aprovada não aceita novas categorias.",
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("versoes_orcamento_categorias")
    .insert({
      tenant_id: session.activeTenant.id,
      versao_orcamento_id: versaoId,
      nome: parsed.data.nome,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[categorias.criar]", error.message);
    return { ok: false, message: mapCategoriaDbError(error.message) };
  }

  revalidatePath(`/orcamentos/${versao.orcamento_id}/versoes/${versaoId}`);
  return { ok: true, id: data.id };
}

export async function renomearCategoria(
  categoriaId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = categoriaSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Nome inválido.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data: categoria } = await supabase
    .from("versoes_orcamento_categorias")
    .select("versao_orcamento_id")
    .eq("id", categoriaId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ versao_orcamento_id: string }>();

  if (!categoria) return { ok: false, message: "Categoria não encontrada." };

  const versao = await loadVersaoParaGrupo(
    categoria.versao_orcamento_id,
    session.activeTenant.id,
  );
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada") {
    return {
      ok: false,
      message: "Versão aprovada não permite renomear categoria.",
    };
  }

  const { error } = await supabase
    .from("versoes_orcamento_categorias")
    .update({ nome: parsed.data.nome })
    .eq("id", categoriaId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[categorias.renomear]", error.message);
    return { ok: false, message: mapCategoriaDbError(error.message) };
  }

  revalidatePath(
    `/orcamentos/${versao.orcamento_id}/versoes/${categoria.versao_orcamento_id}`,
  );
  return { ok: true, id: categoriaId };
}

export async function removerCategoria(
  categoriaId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: categoria } = await supabase
    .from("versoes_orcamento_categorias")
    .select("versao_orcamento_id")
    .eq("id", categoriaId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ versao_orcamento_id: string }>();

  if (!categoria) return { ok: false, message: "Categoria não encontrada." };

  const versao = await loadVersaoParaGrupo(
    categoria.versao_orcamento_id,
    session.activeTenant.id,
  );
  if (!versao) return { ok: false, message: "Versão não encontrada." };
  if (versao.status === "aprovada") {
    return {
      ok: false,
      message: "Versão aprovada não permite remover categoria.",
    };
  }

  // Diferente de grupo: itens NÃO exigem categoria (opcional).
  // FK ON DELETE SET NULL cuida do rebaixamento — nada a fazer antes.
  const { error } = await supabase
    .from("versoes_orcamento_categorias")
    .delete()
    .eq("id", categoriaId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[categorias.remover]", error.message);
    return { ok: false, message: "Não foi possível remover a categoria." };
  }

  revalidatePath(
    `/orcamentos/${versao.orcamento_id}/versoes/${categoria.versao_orcamento_id}`,
  );
  return { ok: true, id: categoriaId };
}

// ============================================================
// ITENS (agora sempre dentro de um grupo)
// ============================================================

function extractItemInput(formData: FormData) {
  return {
    item: formData.get("item")?.toString() ?? "",
    tipo_custo: (formData.get("tipo_custo")?.toString() ?? "A") as any,
    valor_unitario_orcado:
      formData.get("valor_unitario_orcado")?.toString() ?? "0",
    quantidade_orcada: formData.get("quantidade_orcada")?.toString() ?? "1",
    dias_meses_orcado: formData.get("dias_meses_orcado")?.toString() ?? "1",
    categoria_id: (formData.get("categoria_id")?.toString() || "") || null,
    valor_unitario_planejado:
      formData.get("valor_unitario_planejado")?.toString() ?? "0",
    quantidade_planejada:
      formData.get("quantidade_planejada")?.toString() ?? "0",
    dias_meses_planejado:
      formData.get("dias_meses_planejado")?.toString() ?? "0",
  };
}

async function proximaOrdemItem(
  versaoId: string,
  tenantId: string,
): Promise<number> {
  const supabase = createClient();
  const { data } = await supabase
    .from("versoes_orcamento_itens")
    .select("ordem")
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", tenantId)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle<{ ordem: number }>();
  return (data?.ordem ?? 0) + 1;
}

async function assertVersaoEditavel(
  versaoId: string,
  tenantId: string,
): Promise<{ orcamento_id: string } | { error: string }> {
  const supabase = createClient();
  const { data } = await supabase
    .from("versoes_orcamento")
    .select("orcamento_id, status")
    .eq("id", versaoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ orcamento_id: string; status: string }>();

  if (!data) return { error: "Versão não encontrada." };
  if (data.status === "aprovada") {
    return { error: "Versão aprovada não permite alterar itens." };
  }
  return { orcamento_id: data.orcamento_id };
}

export async function adicionarItem(
  grupoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = itemSchema.safeParse(extractItemInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data: grupo } = await supabase
    .from("versoes_orcamento_grupos")
    .select("id, versao_orcamento_id")
    .eq("id", grupoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; versao_orcamento_id: string }>();

  if (!grupo) return { ok: false, message: "Grupo não encontrado." };

  const check = await assertVersaoEditavel(
    grupo.versao_orcamento_id,
    session.activeTenant.id,
  );
  if ("error" in check) return { ok: false, message: check.error };

  const ordem = await proximaOrdemItem(
    grupo.versao_orcamento_id,
    session.activeTenant.id,
  );

  const { data, error } = await supabase
    .from("versoes_orcamento_itens")
    .insert({
      ...parsed.data,
      tenant_id: session.activeTenant.id,
      versao_orcamento_id: grupo.versao_orcamento_id,
      grupo_id: grupo.id,
      ordem,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[itens.adicionar]", error.message);
    return { ok: false, message: "Não foi possível adicionar o item." };
  }

  revalidatePath(
    `/orcamentos/${check.orcamento_id}/versoes/${grupo.versao_orcamento_id}`,
  );
  return { ok: true, id: data.id };
}

export async function atualizarItem(
  itemId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = itemSchema.safeParse(extractItemInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data: item } = await supabase
    .from("versoes_orcamento_itens")
    .select("versao_orcamento_id")
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Pick<VersaoOrcamentoItem, "versao_orcamento_id">>();

  if (!item) return { ok: false, message: "Item não encontrado." };

  const check = await assertVersaoEditavel(
    item.versao_orcamento_id,
    session.activeTenant.id,
  );
  if ("error" in check) return { ok: false, message: check.error };

  const { error } = await supabase
    .from("versoes_orcamento_itens")
    .update(parsed.data)
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[itens.atualizar]", error.message);
    return { ok: false, message: "Não foi possível atualizar o item." };
  }

  revalidatePath(
    `/orcamentos/${check.orcamento_id}/versoes/${item.versao_orcamento_id}`,
  );
  return { ok: true, id: itemId };
}

export async function removerItem(itemId: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: item } = await supabase
    .from("versoes_orcamento_itens")
    .select("versao_orcamento_id")
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Pick<VersaoOrcamentoItem, "versao_orcamento_id">>();

  if (!item) return { ok: false, message: "Item não encontrado." };

  const check = await assertVersaoEditavel(
    item.versao_orcamento_id,
    session.activeTenant.id,
  );
  if ("error" in check) return { ok: false, message: check.error };

  const { error } = await supabase
    .from("versoes_orcamento_itens")
    .delete()
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[itens.remover]", error.message);
    return { ok: false, message: "Não foi possível remover o item." };
  }

  revalidatePath(
    `/orcamentos/${check.orcamento_id}/versoes/${item.versao_orcamento_id}`,
  );
  return { ok: true, id: itemId };
}
