"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  criarCartaoSchema,
  atualizarCartaoSchema,
} from "@/lib/validations/cartao-credito";

const idSchema = z.object({ id: z.string().uuid() });

type Result = { ok: true } | { ok: false; message: string };

async function checarGate(): Promise<
  | {
      ok: true;
      session: Awaited<ReturnType<typeof requireSession>>;
      supabase: ReturnType<typeof createClient>;
    }
  | { ok: false; message: string }
> {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    return {
      ok: false,
      message: "Apenas admin ou financeiro pode gerenciar cartões.",
    };
  }
  return { ok: true, session, supabase: createClient() };
}

export async function criarCartao(input: unknown): Promise<Result> {
  const parsed = criarCartaoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Entrada inválida.",
    };
  }
  const gate = await checarGate();
  if (!gate.ok) return gate;

  const { data, error } = await gate.supabase
    .from("cartoes_credito")
    .insert({
      tenant_id: gate.session.activeTenant.id,
      ...parsed.data,
      created_by: gate.session.profile.id,
    })
    .select("id, nome")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "Já existe um cartão com esse nome." };
    }
    return { ok: false, message: `Falha ao criar cartão: ${error.message}` };
  }

  await logAuditEvent({
    acao: "cartao_credito.criado",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "cartao_credito",
    entidadeId: data.id,
    metadata: {
      nome: parsed.data.nome,
      banco: parsed.data.banco,
      bandeira: parsed.data.bandeira,
      ultimos_4_digitos: parsed.data.ultimos_4_digitos,
    },
  });

  revalidatePath("/cadastros/cartoes-credito");
  revalidatePath("/cadastros");
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true };
}

export async function atualizarCartao(input: unknown): Promise<Result> {
  const parsed = atualizarCartaoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Entrada inválida.",
    };
  }
  const gate = await checarGate();
  if (!gate.ok) return gate;
  const { id, ...patch } = parsed.data;

  const { error } = await gate.supabase
    .from("cartoes_credito")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", gate.session.activeTenant.id);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "Já existe um cartão com esse nome." };
    }
    return {
      ok: false,
      message: `Falha ao atualizar cartão: ${error.message}`,
    };
  }

  await logAuditEvent({
    acao: "cartao_credito.atualizado",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "cartao_credito",
    entidadeId: id,
    metadata: { diff: patch },
  });

  revalidatePath("/cadastros/cartoes-credito");
  revalidatePath("/cadastros");
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true };
}

export async function inativarCartao(input: unknown): Promise<Result> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "ID inválido." };
  const gate = await checarGate();
  if (!gate.ok) return gate;

  const { error } = await gate.supabase
    .from("cartoes_credito")
    .update({ ativo: false })
    .eq("id", parsed.data.id)
    .eq("tenant_id", gate.session.activeTenant.id);
  if (error) return { ok: false, message: `Falha ao inativar: ${error.message}` };

  await logAuditEvent({
    acao: "cartao_credito.inativado",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "cartao_credito",
    entidadeId: parsed.data.id,
    metadata: {},
  });

  revalidatePath("/cadastros/cartoes-credito");
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true };
}

export async function reativarCartao(input: unknown): Promise<Result> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "ID inválido." };
  const gate = await checarGate();
  if (!gate.ok) return gate;

  const { error } = await gate.supabase
    .from("cartoes_credito")
    .update({ ativo: true })
    .eq("id", parsed.data.id)
    .eq("tenant_id", gate.session.activeTenant.id);
  if (error) return { ok: false, message: `Falha ao reativar: ${error.message}` };

  await logAuditEvent({
    acao: "cartao_credito.reativado",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "cartao_credito",
    entidadeId: parsed.data.id,
    metadata: {},
  });

  revalidatePath("/cadastros/cartoes-credito");
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true };
}
