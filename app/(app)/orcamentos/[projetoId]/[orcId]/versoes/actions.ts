"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { honorariosDoOrcamento } from "@/lib/data/clientes";
import { versaoSchema } from "@/lib/validations/versoes";
import {
  itemSchema,
  camposItemEditaveis,
  isCampoItemEditavel,
} from "@/lib/validations/itens";
import { grupoSchema } from "@/lib/validations/grupos";
import type {
  VersaoOrcamento,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
} from "@/lib/types";
import { aceitaBV } from "@/lib/calculos/versao-totais";

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
    .select("id, status, projeto_id")
    .eq("id", orcamentoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: string; projeto_id: string }>();

  if (!orc) return { ok: false, message: "Orçamento não encontrado." };
  if (orc.status === "job_criado" || orc.status === "cancelado") {
    return {
      ok: false,
      message: `Não é possível criar versão em orçamento ${orc.status}.`,
    };
  }

  const projetoId = orc.projeto_id;

  // Honorários da versão nova vem do cadastro do cliente, nunca do form: o
  // drawer mostra o campo travado e não envia nada (11/08/2026).
  const honorariosCliente = await honorariosDoOrcamento(
    orcamentoId,
    session.activeTenant.id,
  );
  if (!honorariosCliente) {
    return {
      ok: false,
      message:
        "Não foi possível ler os honorários do cliente. Confira o cadastro do cliente do projeto.",
    };
  }

  const numero = await proximoNumeroVersao(orcamentoId, session.activeTenant.id);

  const { data, error } = await supabase
    .from("versoes_orcamento")
    .insert({
      ...parsed.data,
      percentual_honorarios: honorariosCliente.percentual,
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

  revalidatePath(`/orcamentos/${projetoId}/${orcamentoId}`);
  redirect(`/orcamentos/${projetoId}/${orcamentoId}/versoes/${data.id}`);
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
    .select("orcamento_id, status, percentual_honorarios")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      orcamento_id: string;
      status: string;
      percentual_honorarios: number;
    }>();

  if (!atual) return { ok: false, message: "Versão não encontrada." };
  if (atual.status === "aprovada") {
    return {
      ok: false,
      message: "Versão aprovada não pode ser alterada manualmente.",
    };
  }

  // Honorários é o único campo desta tela com trava de papel: o padrão vem
  // do cadastro do cliente e só administrador pode divergir dele aqui.
  // Não é gate de tela — quem não pode nem tem o campo habilitado, e sem
  // esta checagem um POST direto passaria por cima disso.
  const honorariosNovo = updates.percentual_honorarios;
  const honorariosMudou =
    typeof honorariosNovo === "number" &&
    Number(atual.percentual_honorarios) !== honorariosNovo;

  if (honorariosMudou && session.activeRole !== "administrador") {
    return {
      ok: false,
      message:
        "Só administrador altera os honorários da versão. O padrão vem do cadastro do cliente.",
    };
  }
  if (!honorariosMudou) delete updates.percentual_honorarios;

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
    metadata: honorariosMudou
      ? {
          campo: "percentual_honorarios",
          de: Number(atual.percentual_honorarios),
          para: honorariosNovo,
        }
      : undefined,
  });

  const { data: orcAtual } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", atual.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ projeto_id: string }>();
  const projetoIdAtual = orcAtual?.projeto_id;

  revalidatePath(`/orcamentos/${projetoIdAtual}/${atual.orcamento_id}`);
  revalidatePath(`/orcamentos/${projetoIdAtual}/${atual.orcamento_id}/versoes/${versaoId}`);
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
      "ordem, grupo_id, categoria_id, planilha_origem, item, tipo_custo, " +
      "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, " +
      "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, " +
      "fornecedor_id, observacoes",
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
          categoria_id: i.categoria_id,
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

  const { data: orcDup } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", original.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ projeto_id: string }>();
  const projetoIdDup = orcDup?.projeto_id;

  revalidatePath(`/orcamentos/${projetoIdDup}/${original.orcamento_id}`);
  redirect(`/orcamentos/${projetoIdDup}/${original.orcamento_id}/versoes/${nova.id}`);
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

  const { data: orcCancel } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", atual.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ projeto_id: string }>();
  const projetoIdCancel = orcCancel?.projeto_id;

  revalidatePath(`/orcamentos/${projetoIdCancel}/${atual.orcamento_id}`);
  return { ok: true, id: versaoId };
}

// ============================================================
// GRUPOS
// ============================================================

async function loadVersaoParaGrupo(
  versaoId: string,
  tenantId: string,
): Promise<{ orcamento_id: string; projeto_id: string; status: string } | null> {
  const supabase = createClient();
  const { data: versao } = await supabase
    .from("versoes_orcamento")
    .select("orcamento_id, status")
    .eq("id", versaoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ orcamento_id: string; status: string }>();
  if (!versao) return null;
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ projeto_id: string }>();
  return { ...versao, projeto_id: orc?.projeto_id ?? "" };
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

  revalidatePath(`/orcamentos/${versao.projeto_id}/${versao.orcamento_id}/versoes/${versaoId}`);
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
    `/orcamentos/${versao.projeto_id}/${versao.orcamento_id}/versoes/${grupo.versao_orcamento_id}`,
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
    `/orcamentos/${versao.projeto_id}/${versao.orcamento_id}/versoes/${grupo.versao_orcamento_id}`,
  );
  return { ok: true, id: grupoId };
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
): Promise<{ orcamento_id: string; projeto_id: string } | { error: string }> {
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
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", data.orcamento_id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ projeto_id: string }>();
  return { orcamento_id: data.orcamento_id, projeto_id: orc?.projeto_id ?? "" };
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
    `/orcamentos/${check.projeto_id}/${check.orcamento_id}/versoes/${grupo.versao_orcamento_id}`,
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
    `/orcamentos/${check.projeto_id}/${check.orcamento_id}/versoes/${item.versao_orcamento_id}`,
  );
  return { ok: true, id: itemId };
}

/**
 * Grava UM campo de UM item — usada pela edição inline da planilha.
 * `campo` chega do cliente, então passa pela allowlist antes de virar
 * UPDATE. Os totais são colunas GENERATED: o banco recalcula sozinho.
 */
/** Tipos em que o cliente paga o fornecedor direto — os únicos com BV. */

/**
 * Chamado quando um item deixa de ser tipo A ou D. O BV só faz sentido
 * nesses dois (é neles que o cliente paga o fornecedor direto e sobra
 * comissão), então a troca de tipo tem que decidir o destino do BV que
 * estava lá.
 *
 * - `a_negociar` → cancela junto, mesmo mecanismo do botão "Remover BV".
 * - `confirmado` / `recebido` → BLOQUEIA a troca de tipo. O BV já foi ao
 *   financeiro; cancelá-lo por um efeito colateral de outra célula seria
 *   apagar dinheiro sem que ninguém pedisse.
 *
 * Retorna a mensagem de bloqueio, ou null quando a troca pode seguir.
 */
async function resolverBvAoSairDoTipoComBv(
  itemId: string,
  tenantId: string,
  itemNome: string,
): Promise<string | null> {
  const supabase = createClient();

  const { data: bv } = await supabase
    .from("itens_bv")
    .select("id, valor, situacao")
    .eq("item_versao_id", itemId)
    .eq("tenant_id", tenantId)
    .neq("situacao", "cancelado")
    .maybeSingle<{ id: string; valor: number; situacao: string }>();

  if (!bv) return null;

  if (bv.situacao !== "a_negociar") {
    return bv.situacao === "recebido"
      ? "Este item tem BV já recebido. Não é possível mudar o tipo de custo."
      : "Este item tem BV já confirmado e enviado ao financeiro. Não é possível mudar o tipo de custo.";
  }

  const { error } = await supabase
    .from("itens_bv")
    .update({ situacao: "cancelado" })
    .eq("id", bv.id)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[itens.tipoCusto.cancelaBv]", error.message);
    return "Não foi possível cancelar o BV deste item. Tipo de custo não alterado.";
  }

  await logAuditEvent({
    acao: "item_bv.cancelado",
    tenantId,
    entidadeTipo: "item_bv",
    entidadeId: bv.id,
    metadata: {
      item_versao_id: itemId,
      item: itemNome,
      valor: bv.valor,
      motivo: "tipo_custo_perdeu_bv",
    },
  });

  return null;
}

export async function atualizarCampoItem(
  itemId: string,
  campo: string,
  valor: string | null,
): Promise<ActionResult> {
  const session = await requireSession();

  if (!isCampoItemEditavel(campo)) {
    return { ok: false, message: "Campo não editável." };
  }

  const parsed = camposItemEditaveis[campo].safeParse(valor ?? undefined);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.errors[0]?.message ?? "Valor inválido.",
    };
  }

  const supabase = createClient();

  // Um único round-trip: item + versão (embed to-one, payload mínimo).
  // Esta é a escrita de maior frequência do app — cada Enter numa célula
  // chega aqui, então não dá para encadear consultas como no atualizarItem.
  const { data: item, error: loadError } = await supabase
    .from("versoes_orcamento_itens")
    .select(
      "item, versao_orcamento_id, versao:versoes_orcamento!inner(orcamento_id, status)",
    )
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      item: string;
      versao_orcamento_id: string;
      versao: { orcamento_id: string; status: string };
    }>();

  if (loadError) {
    console.error("[itens.atualizarCampo.load]", loadError.message);
    return { ok: false, message: "Não foi possível carregar o item." };
  }
  if (!item?.versao) return { ok: false, message: "Item não encontrado." };
  if (item.versao.status === "aprovada") {
    return { ok: false, message: "Versão aprovada não permite alterar itens." };
  }

  // BV só existe em item tipo A ou D. Sair desses tipos tem que resolver
  // o BV que estava lá, senão ele fica órfão no banco e invisível na
  // tela. A consulta extra só roda nesse caso: o caminho quente (cada
  // Enter numa célula numérica) continua com um round-trip só.
  if (campo === "tipo_custo" && !aceitaBV(String(parsed.data))) {
    const bloqueio = await resolverBvAoSairDoTipoComBv(
      itemId,
      session.activeTenant.id,
      item.item,
    );
    if (bloqueio) return { ok: false, message: bloqueio };
  }

  const { error } = await supabase
    .from("versoes_orcamento_itens")
    .update({ [campo]: parsed.data })
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[itens.atualizarCampo]", campo, error.message);
    return { ok: false, message: "Não foi possível salvar a alteração." };
  }

  const { data: orcCampo } = await supabase
    .from("orcamentos")
    .select("projeto_id")
    .eq("id", item.versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ projeto_id: string }>();
  const projetoIdCampo = orcCampo?.projeto_id;

  revalidatePath(
    `/orcamentos/${projetoIdCampo}/${item.versao.orcamento_id}/versoes/${item.versao_orcamento_id}`,
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
    `/orcamentos/${check.projeto_id}/${check.orcamento_id}/versoes/${item.versao_orcamento_id}`,
  );
  return { ok: true, id: itemId };
}

// ============================================================
// APROVAÇÃO
// ============================================================

export async function aprovarVersao(versaoId: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  // 1. Fetch versão + orçamento (com projeto_id pra revalidatePath)
  const { data: versao, error: errVer } = await supabase
    .from("versoes_orcamento")
    .select("id, status, orcamento_id, tenant_id")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: string; orcamento_id: string; tenant_id: string }>();

  if (errVer || !versao) {
    return { ok: false, message: "Versão não encontrada." };
  }

  if (!["rascunho", "em_revisao", "enviada_cliente"].includes(versao.status)) {
    return {
      ok: false,
      message: `Versão em status ${versao.status} não pode ser aprovada.`,
    };
  }

  // 2. Fetch orçamento pra validar status + projeto_id
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("status, projeto_id")
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ status: string; projeto_id: string }>();

  if (!orc) {
    return { ok: false, message: "Orçamento não encontrado." };
  }

  if (["job_criado", "aprovado", "cancelado"].includes(orc.status)) {
    return {
      ok: false,
      message: `Orçamento em status ${orc.status} não aceita nova aprovação.`,
    };
  }

  // 3. Verificar que versão tem ≥1 grupo com ≥1 item
  const { count: itensCount } = await supabase
    .from("versoes_orcamento_itens")
    .select("id", { count: "exact", head: true })
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if ((itensCount ?? 0) === 0) {
    return {
      ok: false,
      message: "Adicione ao menos 1 item antes de aprovar a versão.",
    };
  }

  const agora = new Date().toISOString();

  // 4. Update versão (dispara trigger cascata pras outras versões)
  const { error: errUpdVer } = await supabase
    .from("versoes_orcamento")
    .update({
      status: "aprovada",
      aprovado_em: agora,
      aprovado_por: session.profile.id,
    })
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdVer) {
    console.error("[versao.aprovar]", errUpdVer.message);
    return { ok: false, message: "Não foi possível aprovar a versão." };
  }

  // 5. Update orçamento
  const { error: errUpdOrc } = await supabase
    .from("orcamentos")
    .update({
      status: "aprovado",
      versao_aprovada_id: versaoId,
      aprovado_em: agora,
      aprovado_por: session.profile.id,
    })
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdOrc) {
    console.error("[orcamento.aprovar]", errUpdOrc.message);
    return {
      ok: false,
      message: "Versão aprovada mas orçamento não atualizado. Verifique manualmente.",
    };
  }

  await logAuditEvent({
    acao: "versao_orcamento.aprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: { orcamento_id: versao.orcamento_id },
  });

  revalidatePath(`/orcamentos/${orc.projeto_id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${versao.orcamento_id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${versao.orcamento_id}/versoes/${versaoId}`);
  return { ok: true, id: versaoId };
}

export async function cancelarAprovacaoVersao(
  versaoId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  // 1. Fetch versão
  const { data: versao } = await supabase
    .from("versoes_orcamento")
    .select("id, status, orcamento_id")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: string; orcamento_id: string }>();

  if (!versao) {
    return { ok: false, message: "Versão não encontrada." };
  }

  if (versao.status !== "aprovada") {
    return { ok: false, message: "Só versões aprovadas podem ter aprovação cancelada." };
  }

  // 2. Fetch orçamento (deve estar 'aprovado', não 'job_criado')
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("status, projeto_id")
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ status: string; projeto_id: string }>();

  if (!orc) {
    return { ok: false, message: "Orçamento não encontrado." };
  }

  if (orc.status !== "aprovado") {
    return {
      ok: false,
      message: `Orçamento está em status ${orc.status} — desaprovação não permitida.`,
    };
  }

  // 3. Verifica que não existe job ativo (não-cancelado) pra este orçamento
  const { count: jobsAtivos } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("orcamento_id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "cancelado");

  if ((jobsAtivos ?? 0) > 0) {
    return {
      ok: false,
      message: "Cancele o job antes de desaprovar a versão.",
    };
  }

  // 4. Update versão: volta pra 'em_revisao', limpa aprovado_em/por
  const { error: errUpdVer } = await supabase
    .from("versoes_orcamento")
    .update({
      status: "em_revisao",
      aprovado_em: null,
      aprovado_por: null,
    })
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdVer) {
    console.error("[versao.cancelarAprovacao]", errUpdVer.message);
    return { ok: false, message: "Não foi possível cancelar a aprovação." };
  }

  // 5. Reverter cascata: outras versões 'substituida' do orçamento voltam pra 'em_revisao'
  const { error: errRev } = await supabase
    .from("versoes_orcamento")
    .update({ status: "em_revisao" })
    .eq("orcamento_id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "substituida");

  if (errRev) {
    console.error("[versao.reverter_cascata]", errRev.message);
    // não bloqueia; log e segue
  }

  // 6. Update orçamento
  const { error: errUpdOrc } = await supabase
    .from("orcamentos")
    .update({
      status: "em_revisao",
      versao_aprovada_id: null,
      aprovado_em: null,
      aprovado_por: null,
    })
    .eq("id", versao.orcamento_id)
    .eq("tenant_id", session.activeTenant.id);

  if (errUpdOrc) {
    console.error("[orcamento.cancelarAprovacao]", errUpdOrc.message);
    return {
      ok: false,
      message: "Versão desaprovada mas orçamento não atualizado. Verifique manualmente.",
    };
  }

  await logAuditEvent({
    acao: "versao_orcamento.aprovacao_cancelada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: { orcamento_id: versao.orcamento_id },
  });

  revalidatePath(`/orcamentos/${orc.projeto_id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${versao.orcamento_id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${versao.orcamento_id}/versoes/${versaoId}`);
  return { ok: true, id: versaoId };
}
