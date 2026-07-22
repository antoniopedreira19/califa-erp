"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { orcamentoSchema } from "@/lib/validations/orcamentos";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  return {
    codigo: formData.get("codigo")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
    cliente_id: formData.get("cliente_id")?.toString() ?? "",
    responsavel_id: formData.get("responsavel_id")?.toString() ?? "",
    status: (formData.get("status")?.toString() ?? "rascunho") as any,
    tipo: formData.get("tipo")?.toString() ?? "",
    campanha: formData.get("campanha")?.toString() ?? "",
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

/**
 * Gera um código sequencial "ORC-NNNN" (4 dígitos zero-padded)
 * baseado na contagem atual de orçamentos do tenant + 1.
 * Sujeito a race condition em cenários de concorrência alta — para o
 * MVP é aceitável (o índice único no banco pega colisões).
 */
async function generateCodigo(tenantId: string): Promise<string> {
  const supabase = createClient();
  const { count } = await supabase
    .from("orcamentos")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  const next = (count ?? 0) + 1;
  return `ORC-${next.toString().padStart(4, "0")}`;
}

export async function criarOrcamento(
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

  const codigo = parsed.data.codigo ?? (await generateCodigo(session.activeTenant.id));

  const supabase = createClient();
  const { data, error } = await supabase
    .from("orcamentos")
    .insert({
      ...parsed.data,
      codigo,
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
    metadata: { codigo, nome: parsed.data.nome, cliente_id: parsed.data.cliente_id },
  });

  revalidatePath("/orcamentos");
  redirect(`/orcamentos/${data.id}`);
}

export async function atualizarOrcamento(
  id: string,
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

  // Bloqueio de segurança: se o orçamento já estiver 'aprovado' ou
  // 'job_criado', não permitir voltar via edição manual.
  const { data: atual } = await supabase
    .from("orcamentos")
    .select("status")
    .eq("id", id)
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
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[orcamentos.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "orcamento.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "orcamento",
    entidadeId: id,
  });

  revalidatePath("/orcamentos");
  revalidatePath(`/orcamentos/${id}`);
  return { ok: true, id };
}
