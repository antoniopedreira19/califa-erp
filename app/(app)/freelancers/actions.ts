"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { freelancerSchema } from "@/lib/validations/freelancers";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Admin, RH e Financeiro podem cadastrar/editar freelancer. GP e
 * produtor leem via RLS (SELECT policy permite tenant_member) mas não
 * passam pela policy de INSERT/UPDATE.
 */
function podeEscrever(role: string): boolean {
  return role === "administrador" || role === "rh" || role === "financeiro";
}

/**
 * Lê FormData e aplica o schema. Normalização (dígitos puros, trim) é feita
 * pelo Zod via `.transform()`. Campos vazios viram null — o schema trata.
 */
function parseFormData(formData: FormData) {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string") raw[k] = v;
  }
  return freelancerSchema.safeParse(raw);
}

type ErroTratado = {
  message: string;
  fieldErrors?: Record<string, string[]>;
};

function tratarErroPostgres(
  code: string | undefined,
  constraint: string | undefined,
): ErroTratado | null {
  if (code === "23505") {
    if (constraint?.includes("cpf")) {
      return {
        message: "Já existe um freelancer com esse CPF",
        fieldErrors: { cpf: ["CPF já cadastrado"] },
      };
    }
    if (constraint?.includes("cnpj")) {
      return {
        message: "Já existe um freelancer com esse CNPJ",
        fieldErrors: { cnpj: ["CNPJ já cadastrado"] },
      };
    }
    return { message: "Registro duplicado" };
  }
  if (code === "23514") {
    if (constraint === "freelancers_cnpj_razao_social_par") {
      return {
        message: "CNPJ e Razão Social precisam ser preenchidos juntos",
        fieldErrors: {
          cnpj: ["Preenchimento obrigatório em par com Razão Social"],
          razao_social: ["Preenchimento obrigatório em par com CNPJ"],
        },
      };
    }
    return { message: "Dados fora das regras do banco" };
  }
  return null;
}

export async function criarFreelancer(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  if (!podeEscrever(session.activeRole)) {
    return { ok: false, message: "Sem permissão para cadastrar freelancer" };
  }

  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Dados inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("freelancers")
    .insert({
      ...parsed.data,
      tenant_id: session.activeTenant.id,
      origem: "manual",
      created_by: session.profile.id,
      updated_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    const tratado = tratarErroPostgres(error.code, error.message);
    if (tratado) return { ok: false, ...tratado };
    console.error("[freelancers.criar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer",
    entidadeId: data.id,
    metadata: {
      nome_social: parsed.data.nome_social,
      cpf: parsed.data.cpf,
    },
  });

  revalidatePath("/freelancers/lista");
  redirect(`/freelancers/${data.id}`);
}

export async function atualizarFreelancer(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!podeEscrever(session.activeRole)) {
    return { ok: false, message: "Sem permissão para editar freelancer" };
  }

  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Dados inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("freelancers")
    .update({
      ...parsed.data,
      updated_by: session.profile.id,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    const tratado = tratarErroPostgres(error.code, error.message);
    if (tratado) return { ok: false, ...tratado };
    console.error("[freelancers.atualizar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer",
    entidadeId: id,
    metadata: {
      nome_social: parsed.data.nome_social,
    },
  });

  revalidatePath("/freelancers/lista");
  revalidatePath(`/freelancers/${id}`);
  return { ok: true };
}
