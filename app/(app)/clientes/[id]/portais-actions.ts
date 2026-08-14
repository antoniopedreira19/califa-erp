"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { clientePortalSchema } from "@/lib/validations/envio-faturamento";

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function mapErro(msg: string): string {
  if (msg.includes("uniq_cliente_portal_nome")) {
    return "Já existe um portal com esse nome para este cliente.";
  }
  return "Não foi possível salvar o portal.";
}

function extrair(formData: FormData) {
  return {
    nome: formData.get("nome")?.toString() ?? "",
    url: formData.get("url")?.toString() ?? "",
  };
}

/**
 * Portais de fornecedor do cliente — onde a nota é lançada.
 *
 * São vários por cliente de propósito: certos clientes mantêm mais de um
 * portal (decisão do time, 13/08/2026). O envio do job para faturamento
 * escolhe qual usar.
 */
export async function criarPortal(
  clienteId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = clientePortalSchema.safeParse(extrair(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  // O cliente precisa ser do tenant da sessão — o id vem da URL.
  const { data: cliente } = await supabase
    .from("clientes")
    .select("id")
    .eq("id", clienteId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string }>();

  if (!cliente) return { ok: false, message: "Cliente não encontrado." };

  const { error } = await supabase.from("cliente_portais").insert({
    tenant_id: session.activeTenant.id,
    cliente_id: clienteId,
    nome: parsed.data.nome,
    url: parsed.data.url,
    created_by: session.profile.id,
  });

  if (error) {
    console.error("[cliente_portais.criar]", error.message);
    return { ok: false, message: mapErro(error.message) };
  }

  await logAuditEvent({
    acao: "cliente_portal.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: clienteId,
    metadata: { nome: parsed.data.nome },
  });

  revalidatePath(`/clientes/${clienteId}`);
  return { ok: true };
}

export async function editarPortal(
  clienteId: string,
  portalId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = clientePortalSchema.safeParse(extrair(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("cliente_portais")
    .update({ nome: parsed.data.nome, url: parsed.data.url })
    .eq("id", portalId)
    .eq("cliente_id", clienteId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[cliente_portais.editar]", error.message);
    return { ok: false, message: mapErro(error.message) };
  }

  await logAuditEvent({
    acao: "cliente_portal.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: clienteId,
    metadata: { portal_id: portalId, nome: parsed.data.nome },
  });

  revalidatePath(`/clientes/${clienteId}`);
  return { ok: true };
}

/**
 * Inativa em vez de apagar: envios de faturamento antigos apontam para o
 * portal, e a lista deles precisa continuar fazendo sentido.
 */
export async function alternarPortal(
  clienteId: string,
  portalId: string,
  ativo: boolean,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase
    .from("cliente_portais")
    .update({ ativo })
    .eq("id", portalId)
    .eq("cliente_id", clienteId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[cliente_portais.alternar]", error.message);
    return { ok: false, message: "Não foi possível alterar o portal." };
  }

  await logAuditEvent({
    acao: "cliente_portal.removido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: clienteId,
    metadata: { portal_id: portalId, ativo },
  });

  revalidatePath(`/clientes/${clienteId}`);
  return { ok: true };
}
