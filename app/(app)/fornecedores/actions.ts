"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { fornecedorSchema } from "@/lib/validations/fornecedores";
import { getBancoByCodigo } from "@/lib/dados/bancos-febraban";
import { onlyDigits } from "@/lib/utils";
import type { PixTipoChave } from "@/lib/types";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  return {
    // Campos existentes
    tipo_pessoa: formData.get("tipo_pessoa"),
    nome: formData.get("nome"),
    razao_social: formData.get("razao_social"),
    cpf_cnpj: formData.get("cpf_cnpj"),
    email: formData.get("email"),
    telefone: formData.get("telefone"),
    observacoes: formData.get("observacoes"),

    // Endereço
    cep: formData.get("cep"),
    logradouro: formData.get("logradouro"),
    numero: formData.get("numero"),
    complemento: formData.get("complemento"),
    bairro: formData.get("bairro"),
    cidade: formData.get("cidade"),
    uf: formData.get("uf"),

    // Banco
    banco_codigo: formData.get("banco_codigo"),
    agencia: formData.get("agencia"),
    agencia_dv: formData.get("agencia_dv"),
    conta: formData.get("conta"),
    conta_dv: formData.get("conta_dv"),
    tipo_conta: formData.get("tipo_conta"),

    // PIX
    pix_tipo: formData.get("pix_tipo"),
    pix_chave: formData.get("pix_chave"),
  };
}

function deriveBancoNome(
  banco_codigo: string | null | undefined,
): { ok: true; banco_nome: string | null } | { ok: false; message: string } {
  if (!banco_codigo) return { ok: true, banco_nome: null };
  const banco = getBancoByCodigo(banco_codigo);
  if (!banco) return { ok: false, message: "Banco selecionado é inválido." };
  return { ok: true, banco_nome: banco.nome };
}

function normalizePixChave(
  pix_tipo: string | null | undefined,
  pix_chave: string | null | undefined,
): string | null | undefined {
  if (!pix_tipo || !pix_chave) return pix_chave;
  switch (pix_tipo) {
    case "cpf":
    case "cnpj":
    case "telefone":
      return onlyDigits(pix_chave);
    case "email":
    case "aleatoria":
      return pix_chave.trim().toLowerCase();
    default:
      return pix_chave;
  }
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_fornecedores_documento_por_tenant")) {
    return "Já existe um fornecedor com este documento neste tenant.";
  }
  if (msg.includes("fornecedores_documento_formato")) {
    return "Documento não confere com o tipo de pessoa selecionado.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

export async function criarFornecedor(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = fornecedorSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const bancoResult = deriveBancoNome(parsed.data.banco_codigo);
  if (!bancoResult.ok) {
    return { ok: false, message: bancoResult.message };
  }

  const pix_chave_normalizada = normalizePixChave(
    parsed.data.pix_tipo,
    parsed.data.pix_chave,
  );

  const supabase = createClient();
  const { data, error } = await supabase
    .from("fornecedores")
    .insert({
      ...parsed.data,
      banco_nome: bancoResult.banco_nome,
      pix_chave: pix_chave_normalizada,
      tenant_id: session.activeTenant.id,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[fornecedores.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "fornecedor.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: data.id,
    metadata: { nome: parsed.data.nome, tipo_pessoa: parsed.data.tipo_pessoa },
  });

  revalidatePath("/fornecedores");
  redirect(`/fornecedores/${data.id}`);
}

export async function atualizarFornecedor(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = fornecedorSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const bancoResult = deriveBancoNome(parsed.data.banco_codigo);
  if (!bancoResult.ok) {
    return { ok: false, message: bancoResult.message };
  }

  const pix_chave_normalizada = normalizePixChave(
    parsed.data.pix_tipo,
    parsed.data.pix_chave,
  );

  const supabase = createClient();
  const { error } = await supabase
    .from("fornecedores")
    .update({
      ...parsed.data,
      banco_nome: bancoResult.banco_nome,
      pix_chave: pix_chave_normalizada,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[fornecedores.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "fornecedor.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: id,
  });

  revalidatePath("/fornecedores");
  revalidatePath(`/fornecedores/${id}`);
  return { ok: true, id };
}

export async function verificarPixDuplicado(
  chave: string,
  pixTipo: PixTipoChave | null,
  excludeId?: string,
): Promise<{ existe: true; id: string; nome: string } | { existe: false }> {
  const chaveLimpa =
    pixTipo && chave
      ? normalizePixChave(pixTipo, chave) ?? chave.trim()
      : chave.trim();
  if (!chaveLimpa) return { existe: false };

  const supabase = createClient();

  let query = supabase
    .from("fornecedores")
    .select("id, nome")
    .eq("pix_chave", chaveLimpa)
    .eq("status", "ativo")
    .limit(1);

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return { existe: false };
  return { existe: true, id: data.id, nome: data.nome };
}

export async function inativarFornecedor(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase
    .from("fornecedores")
    .update({ status: "inativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[fornecedores.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar." };
  }

  await logAuditEvent({
    acao: "fornecedor.inativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: id,
  });

  revalidatePath("/fornecedores");
  return { ok: true, id };
}

export async function reativarFornecedor(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase
    .from("fornecedores")
    .update({ status: "ativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[fornecedores.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "fornecedor.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: id,
    metadata: { acao: "reativado" },
  });

  revalidatePath("/fornecedores");
  return { ok: true, id };
}
