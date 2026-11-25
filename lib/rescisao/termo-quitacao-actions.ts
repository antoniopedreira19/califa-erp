"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { pode } from "@/lib/permissoes";
import { createClient } from "@/lib/supabase/server";

// O termo de quitação da rescisão reusa o bucket de NF de colaborador —
// a policy do bucket já libera leitura/escrita pra qualquer membro do
// tenant, com `is_tenant_member` casando no primeiro segmento do path.
// Path segue o padrão `<tenant>/<colab>/rescisao-termo/<rescisao_id>.pdf`.
const BUCKET = "colaboradores-nf";
const MAX_BYTES = 10 * 1024 * 1024;

type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

function pathDoTermo(
  tenantId: string,
  colaboradorId: string,
  rescisaoId: string,
): string {
  return `${tenantId}/${colaboradorId}/rescisao-termo/${rescisaoId}.pdf`;
}

async function carregarRescisao(rescisaoId: string, tenantId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("rescisoes")
    .select(
      "id, colaborador_id, tenant_id, termo_quitacao_path, termo_quitacao_nome",
    )
    .eq("id", rescisaoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

/**
 * Anexa (ou substitui) o termo de quitação de uma rescisão.
 * Permissão: admin + rh (mesma alçada que edita a rescisão).
 */
export async function anexarTermoQuitacao(
  formData: FormData,
): Promise<ActionResult<{ rescisaoId: string }>> {
  const session = await requireSession();

  if (!pode(session.activeRole, "rh.nf.anexar_qualquer")) {
    return { ok: false, message: "Sem permissão para anexar o termo." };
  }

  const rescisaoId = formData.get("rescisaoId");
  const file = formData.get("file");

  if (typeof rescisaoId !== "string" || !rescisaoId) {
    return { ok: false, message: "Rescisão inválida." };
  }
  if (!(file instanceof File)) {
    return { ok: false, message: "Arquivo ausente." };
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, message: "Só aceita arquivo PDF." };
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return {
      ok: false,
      message: `Arquivo precisa ter entre 1 byte e ${MAX_BYTES / 1024 / 1024} MB.`,
    };
  }

  const resc = await carregarRescisao(rescisaoId, session.activeTenant.id);
  if (!resc) {
    return { ok: false, message: "Rescisão não encontrada." };
  }

  const supabase = createClient();
  const buffer = Buffer.from(await file.arrayBuffer());
  const arquivoHash = createHash("sha256").update(buffer).digest("hex");
  const path = pathDoTermo(
    session.activeTenant.id,
    resc.colaborador_id as string,
    resc.id as string,
  );

  // Remove arquivo antigo se o path mudou (defesa contra mudança de esquema).
  const pathAntigo = resc.termo_quitacao_path as string | null;
  if (pathAntigo && pathAntigo !== path) {
    await supabase.storage.from(BUCKET).remove([pathAntigo]);
  }

  const upload = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: "application/pdf", upsert: true });
  if (upload.error) {
    return {
      ok: false,
      message: `Falha ao subir arquivo: ${upload.error.message}`,
    };
  }

  const nowIso = new Date().toISOString();
  const { error: updError } = await supabase
    .from("rescisoes")
    .update({
      termo_quitacao_path: path,
      termo_quitacao_nome: file.name,
      termo_quitacao_tamanho_bytes: file.size,
      termo_quitacao_uploaded_at: nowIso,
      termo_quitacao_uploaded_by: session.profile.id,
      updated_by: session.profile.id,
    })
    .eq("id", resc.id);

  if (updError) {
    await supabase.storage.from(BUCKET).remove([path]);
    return {
      ok: false,
      message: `Falha ao gravar metadado: ${updError.message}`,
    };
  }

  await logAuditEvent({
    acao: "rescisao.termo_quitacao_anexado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "rescisao",
    entidadeId: resc.id as string,
    metadata: {
      colaborador_id: resc.colaborador_id,
      arquivo_hash: arquivoHash,
      arquivo_nome: file.name,
      substituiu_anterior: !!pathAntigo,
    },
  });

  revalidatePath(`/rh/colaboradores/${resc.colaborador_id}`);
  revalidatePath("/rh/rescisoes");

  return { ok: true, rescisaoId: resc.id as string };
}

/**
 * Remove o termo de quitação. Permissão: admin + rh.
 */
export async function removerTermoQuitacao(input: {
  rescisaoId: string;
}): Promise<ActionResult> {
  const session = await requireSession();

  if (!pode(session.activeRole, "rh.nf.anexar_qualquer")) {
    return { ok: false, message: "Sem permissão para remover o termo." };
  }

  const resc = await carregarRescisao(input.rescisaoId, session.activeTenant.id);
  if (!resc) {
    return { ok: false, message: "Rescisão não encontrada." };
  }
  if (!resc.termo_quitacao_path) {
    return { ok: false, message: "Nenhum termo anexado." };
  }

  const supabase = createClient();
  await supabase.storage.from(BUCKET).remove([resc.termo_quitacao_path as string]);

  const { error: updError } = await supabase
    .from("rescisoes")
    .update({
      termo_quitacao_path: null,
      termo_quitacao_nome: null,
      termo_quitacao_tamanho_bytes: null,
      termo_quitacao_uploaded_at: null,
      termo_quitacao_uploaded_by: null,
      updated_by: session.profile.id,
    })
    .eq("id", resc.id);

  if (updError) {
    return { ok: false, message: updError.message };
  }

  await logAuditEvent({
    acao: "rescisao.termo_quitacao_removido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "rescisao",
    entidadeId: resc.id as string,
    metadata: { colaborador_id: resc.colaborador_id },
  });

  revalidatePath(`/rh/colaboradores/${resc.colaborador_id}`);
  revalidatePath("/rh/rescisoes");

  return { ok: true } as { ok: true } & Record<string, never>;
}

/**
 * Signed URL de 10 min pra baixar o termo. Permissão: `rh.nf.ver`
 * (admin, rh, financeiro) — espelha a regra de baixar NF.
 */
export async function baixarTermoQuitacao(input: {
  rescisaoId: string;
}): Promise<ActionResult<{ url: string; arquivo_nome: string }>> {
  const session = await requireSession();

  if (!pode(session.activeRole, "rh.nf.ver")) {
    return { ok: false, message: "Sem permissão para baixar o termo." };
  }

  const resc = await carregarRescisao(input.rescisaoId, session.activeTenant.id);
  if (!resc || !resc.termo_quitacao_path) {
    return { ok: false, message: "Termo não encontrado." };
  }

  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(resc.termo_quitacao_path as string, 60 * 10);
  if (error || !data) {
    return { ok: false, message: `Falha ao gerar link: ${error?.message}` };
  }

  await logAuditEvent({
    acao: "rescisao.termo_quitacao_baixado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "rescisao",
    entidadeId: resc.id as string,
    metadata: { colaborador_id: resc.colaborador_id },
  });

  return {
    ok: true,
    url: data.signedUrl,
    arquivo_nome: (resc.termo_quitacao_nome as string) ?? "termo-quitacao.pdf",
  };
}
