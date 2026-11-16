"use server";

/**
 * Server actions pra o RH/admin gerenciar documentos do colaborador.
 * O próprio colaborador usa as actions de `_boas-vindas/actions.ts`.
 *
 * RLS: colaboradores_documentos já libera SELECT/DELETE pra RH/admin
 * do tenant e para o próprio colaborador. Aqui a action só confirma a
 * autorização "é RH/admin?" antes de deletar + loga auditoria.
 */

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import type { ColaboradorDocumento } from "@/lib/types";

type ActionResult = { ok: true } | { ok: false; message: string };

export async function removerDocumentoDoColaboradorRh(
  documentoId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    return { ok: false, message: "Sem permissão." };
  }

  const supabase = createClient();

  const { data: doc } = await supabase
    .from("colaboradores_documentos")
    .select("id, tenant_id, colaborador_id, arquivo_path, tipo")
    .eq("id", documentoId)
    .maybeSingle();

  if (!doc) return { ok: false, message: "Documento não encontrado." };

  const d = doc as Pick<
    ColaboradorDocumento,
    "id" | "tenant_id" | "colaborador_id" | "arquivo_path" | "tipo"
  >;

  // Apaga arquivo primeiro (ignora erro de "não existe"), depois a linha.
  await supabase.storage
    .from("colaboradores-documentos")
    .remove([d.arquivo_path]);

  const { error } = await supabase
    .from("colaboradores_documentos")
    .delete()
    .eq("id", documentoId);

  if (error) {
    return { ok: false, message: "Falha ao remover: " + error.message };
  }

  await logAuditEvent({
    acao: "perfil.documento_removido",
    tenantId: d.tenant_id,
    entidadeTipo: "colaborador_documento",
    entidadeId: documentoId,
    metadata: {
      colaborador_id: d.colaborador_id,
      tipo: d.tipo,
      removido_por: "rh",
    },
  });

  revalidatePath(`/rh/colaboradores/${d.colaborador_id}`);
  return { ok: true };
}
