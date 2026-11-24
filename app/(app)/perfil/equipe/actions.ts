"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import {
  aprovarComoLiderSchema,
  reprovarComoLiderSchema,
} from "@/lib/ferias/aprovar-como-lider-schema";

type ActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

/** Aprova a etapa 1 (líder) de uma solicitação de férias em
 *  `aguardando_gestor`. Após a aprovação, o lançamento vai pra
 *  `pendente_aprovacao` — fluxo normal do RH a partir daí. */
export async function aprovarLancamentoComoLider(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = aprovarComoLiderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Dados inválidos.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }
  const { lancamentoId } = parsed.data;

  const supabase = createClient();

  const { data: lanc } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select("id, tenant_id, colaborador_id, status")
    .eq("id", lancamentoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!lanc) return { ok: false, message: "Lançamento não encontrado." };
  if (lanc.status !== "aguardando_gestor") {
    return {
      ok: false,
      message: "Esta solicitação não está mais aguardando sua aprovação.",
    };
  }

  // Guard: o caller é um dos N líderes deste colaborador?
  // Tabela `colaboradores_lideres` tem policy que libera leitura pro
  // próprio líder; se não há linha, não é líder.
  const { data: vinculo } = await supabase
    .from("colaboradores_lideres")
    .select("lider_id")
    .eq("colaborador_id", lanc.colaborador_id)
    .eq("lider_id", session.profile.id)
    .maybeSingle();

  if (!vinculo) {
    return {
      ok: false,
      message: "Você não é um dos líderes deste colaborador.",
    };
  }

  const { data: atualizado, error } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .update({
      status: "pendente_aprovacao",
      aprovado_pelo_lider_por: session.profile.id,
      aprovado_pelo_lider_em: new Date().toISOString(),
    })
    .eq("id", lancamentoId)
    .select("id")
    .single();

  if (error || !atualizado) {
    console.error(
      "[equipe.aprovarComoLider]",
      error?.message ?? "update filtrado pela RLS",
    );
    return {
      ok: false,
      message:
        "Falha ao aprovar" + (error?.message ? ": " + error.message : "."),
    };
  }

  await logAuditEvent({
    acao: "ferias.lancamento.aprovado_lider",
    tenantId: session.activeTenant.id,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lancamentoId,
    metadata: { colaborador_id: lanc.colaborador_id },
  });

  revalidatePath("/perfil/equipe");
  revalidatePath("/rh/ferias");
  return { ok: true, id: lancamentoId };
}

/** Reprova (na etapa 1 — líder) uma solicitação em `aguardando_gestor`.
 *  Grava o motivo no campo compartilhado `motivo_reprovacao` e marca
 *  `aprovado_pelo_lider_*` como rastro de quem decidiu. O colaborador
 *  abre nova solicitação se quiser; não há "reenviar". */
export async function reprovarLancamentoComoLider(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = reprovarComoLiderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Dados inválidos.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }
  const { lancamentoId, motivo } = parsed.data;

  const supabase = createClient();

  const { data: lanc } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select("id, tenant_id, colaborador_id, status")
    .eq("id", lancamentoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!lanc) return { ok: false, message: "Lançamento não encontrado." };
  if (lanc.status !== "aguardando_gestor") {
    return {
      ok: false,
      message: "Esta solicitação não está mais aguardando sua aprovação.",
    };
  }

  // Guard: o caller é um dos N líderes deste colaborador?
  const { data: vinculo } = await supabase
    .from("colaboradores_lideres")
    .select("lider_id")
    .eq("colaborador_id", lanc.colaborador_id)
    .eq("lider_id", session.profile.id)
    .maybeSingle();

  if (!vinculo) {
    return {
      ok: false,
      message: "Você não é um dos líderes deste colaborador.",
    };
  }

  const { data: atualizado, error } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .update({
      status: "reprovado",
      aprovado_pelo_lider_por: session.profile.id,
      aprovado_pelo_lider_em: new Date().toISOString(),
      motivo_reprovacao: motivo,
    })
    .eq("id", lancamentoId)
    .select("id")
    .single();

  if (error || !atualizado) {
    console.error(
      "[equipe.reprovarComoLider]",
      error?.message ?? "update filtrado pela RLS",
    );
    return {
      ok: false,
      message:
        "Falha ao reprovar" + (error?.message ? ": " + error.message : "."),
    };
  }

  await logAuditEvent({
    acao: "ferias.lancamento.reprovado_lider",
    tenantId: session.activeTenant.id,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lancamentoId,
    metadata: { colaborador_id: lanc.colaborador_id, motivo },
  });

  revalidatePath("/perfil/equipe");
  revalidatePath("/rh/ferias");
  return { ok: true, id: lancamentoId };
}
