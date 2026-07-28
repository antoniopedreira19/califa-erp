"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { orcamentoSchema } from "@/lib/validations/orcamentos";
import { gerarCodigoOrcamento } from "@/lib/codigos/orcamentos";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  return {
    codigo: formData.get("codigo")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
    status: (formData.get("status")?.toString() ?? "rascunho") as any,
    categoria_id: formData.get("categoria_id")?.toString() ?? "",
    data_inicio_prevista: formData.get("data_inicio_prevista")?.toString() ?? "",
    data_fim_prevista: formData.get("data_fim_prevista")?.toString() ?? "",
  };
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_orcamentos_codigo_por_tenant")) {
    return "Já existe um orçamento com este código neste tenant.";
  }
  if (msg.includes("orcamentos_datas_ordem")) {
    return "Data fim precisa ser igual ou posterior à data início.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

async function assertProjetoDoTenant(
  supabase: ReturnType<typeof createClient>,
  projetoId: string,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("projetos")
    .select("id")
    .eq("id", projetoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, message: "Projeto não encontrado." };
  }
  return { ok: true };
}

export async function criarOrcamento(
  projetoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = orcamentoSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const chk = await assertProjetoDoTenant(supabase, projetoId, session.activeTenant.id);
  if (!chk.ok) return chk;

  let codigo: string;
  try {
    codigo = parsed.data.codigo ?? (await gerarCodigoOrcamento(supabase, projetoId, session.activeTenant.id));
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const { codigo: _unused, ...rest } = parsed.data;

  const { data, error } = await supabase
    .from("orcamentos")
    .insert({
      ...rest,
      codigo,
      projeto_id: projetoId,
      tenant_id: session.activeTenant.id,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[orcamentos.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "orcamento.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "orcamento",
    entidadeId: data.id,
    metadata: { codigo, nome: parsed.data.nome, projeto_id: projetoId },
  });

  revalidatePath(`/orcamentos/${projetoId}`);
  redirect(`/orcamentos/${projetoId}/${data.id}`);
}

export async function atualizarOrcamento(
  projetoId: string,
  orcId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = orcamentoSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const { data: atual } = await supabase
    .from("orcamentos")
    .select("status")
    .eq("id", orcId)
    .eq("projeto_id", projetoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ status: string }>();

  if (!atual) {
    return { ok: false, message: "Orçamento não encontrado." };
  }
  if (atual.status === "aprovado" || atual.status === "job_criado") {
    return {
      ok: false,
      message:
        "Orçamento em estado protegido (aprovado ou com job criado). Alterações precisam ser feitas pela Task 004/005.",
    };
  }

  const { codigo, ...rest } = parsed.data;
  const payload = codigo ? { ...rest, codigo } : rest;

  const { error } = await supabase
    .from("orcamentos")
    .update(payload)
    .eq("id", orcId)
    .eq("projeto_id", projetoId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[orcamentos.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "orcamento.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "orcamento",
    entidadeId: orcId,
  });

  revalidatePath(`/orcamentos/${projetoId}`);
  revalidatePath(`/orcamentos/${projetoId}/${orcId}`);
  return { ok: true, id: orcId };
}
