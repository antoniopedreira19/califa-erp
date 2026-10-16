import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PODE_ENVIAR = new Set(["administrador", "rh", "financeiro"]);
const TAMANHO_MAX = 10 * 1024 * 1024; // 10 MB

/**
 * POST /api/freelancers/contratos/[id]/enviar-assinado
 *
 * Recebe multipart com campo "arquivo" (PDF). Upload no bucket
 * freelancer-arquivos. Atualiza `arquivo_url`. Overwrite se já existir.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  if (!PODE_ENVIAR.has(session.activeRole)) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const formData = await request.formData();
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File)) {
    return NextResponse.json(
      { error: "Arquivo não enviado" },
      { status: 400 },
    );
  }

  if (arquivo.type !== "application/pdf") {
    return NextResponse.json(
      { error: "Arquivo precisa ser PDF" },
      { status: 400 },
    );
  }

  if (arquivo.size > TAMANHO_MAX) {
    return NextResponse.json(
      { error: "Arquivo acima de 10 MB" },
      { status: 400 },
    );
  }

  const supabase = createClient();

  // Checa que o contrato existe no tenant
  const { data: contrato, error: contratoErr } = await supabase
    .from("freelancer_contratos")
    .select("id")
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (contratoErr || !contrato) {
    return NextResponse.json(
      { error: "Contrato não encontrado" },
      { status: 404 },
    );
  }

  const path = `${session.activeTenant.id}/contratos/${params.id}/assinado.pdf`;
  const buffer = Buffer.from(await arquivo.arrayBuffer());

  const { error: uploadErr } = await supabase.storage
    .from("freelancer-arquivos")
    .upload(path, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadErr) {
    console.error("[contrato.enviar-assinado.upload]", uploadErr.message);
    return NextResponse.json(
      { error: `Falha no upload: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  const { error: updateErr } = await supabase
    .from("freelancer_contratos")
    .update({ arquivo_url: path, updated_by: session.profile.id })
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id);

  if (updateErr) {
    console.error("[contrato.enviar-assinado.update]", updateErr.message);
    return NextResponse.json(
      { error: `Falha ao atualizar contrato: ${updateErr.message}` },
      { status: 500 },
    );
  }

  await logAuditEvent({
    acao: "freelancer_contrato.assinado_enviado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_contrato",
    entidadeId: params.id,
    metadata: { path, size: arquivo.size },
  });

  return NextResponse.json({ ok: true, path });
}
