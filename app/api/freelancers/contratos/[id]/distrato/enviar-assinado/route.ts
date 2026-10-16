import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PODE_ENVIAR = new Set(["administrador", "rh", "financeiro"]);
const TAMANHO_MAX = 10 * 1024 * 1024;

/**
 * Upload do PDF assinado do distrato. Após o upload, chama a RPC
 * aplicar_distrato_de_contrato que:
 *   - preserva data_termino_original (snapshot)
 *   - seta data_termino = distrato_data_proposta
 *   - seta status_real = false
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
    return NextResponse.json({ error: "Arquivo não enviado" }, { status: 400 });
  }
  if (arquivo.type !== "application/pdf") {
    return NextResponse.json(
      { error: "Arquivo precisa ser PDF" },
      { status: 400 },
    );
  }
  if (arquivo.size > TAMANHO_MAX) {
    return NextResponse.json({ error: "Arquivo acima de 10 MB" }, { status: 400 });
  }

  const supabase = createClient();
  const { data: contrato, error: contratoErr } = await supabase
    .from("freelancer_contratos")
    .select("id, distrato_data_proposta")
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (contratoErr || !contrato) {
    return NextResponse.json(
      { error: "Contrato não encontrado" },
      { status: 404 },
    );
  }

  if (!(contrato as any).distrato_data_proposta) {
    return NextResponse.json(
      { error: "Solicite o distrato antes de enviar o assinado" },
      { status: 422 },
    );
  }

  const path = `${session.activeTenant.id}/contratos/${params.id}/distrato-assinado.pdf`;
  const buffer = Buffer.from(await arquivo.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from("freelancer-arquivos")
    .upload(path, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upErr) {
    return NextResponse.json(
      { error: `Falha no upload: ${upErr.message}` },
      { status: 500 },
    );
  }

  // Salva o path do assinado e chama a RPC pra aplicar a antecipação
  const { error: updErr } = await supabase
    .from("freelancer_contratos")
    .update({
      distrato_arquivo_url: path,
      updated_by: session.profile.id,
    })
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  const { error: rpcErr } = await supabase.rpc("aplicar_distrato_de_contrato", {
    p_contrato_id: params.id,
  });
  if (rpcErr) {
    console.error("[distrato.aplicar]", rpcErr.message);
    return NextResponse.json(
      { error: `Falha ao aplicar distrato: ${rpcErr.message}` },
      { status: 500 },
    );
  }

  await logAuditEvent({
    acao: "freelancer_contrato.distrato_aplicado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_contrato",
    entidadeId: params.id,
    metadata: { path, size: arquivo.size },
  });

  return NextResponse.json({ ok: true, path });
}
