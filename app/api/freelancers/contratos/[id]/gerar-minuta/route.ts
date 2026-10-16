import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import type { Freelancer, FreelancerContrato } from "@/lib/types";
import { gerarFreelancerContratoDocx } from "@/lib/freelancer-contrato-docx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PODE_GERAR = new Set(["administrador", "rh", "financeiro"]);

/**
 * POST /api/freelancers/contratos/[id]/gerar-minuta
 *
 * Gera o DOCX da minuta, faz upload no bucket `freelancer-arquivos` e
 * atualiza `freelancer_contratos.minuta_url` com o path. Overwrite se
 * já existir.
 */
export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  if (!PODE_GERAR.has(session.activeRole)) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const supabase = createClient();

  const { data: contratoRaw, error: contratoErr } = await supabase
    .from("freelancer_contratos")
    .select("*, freelancer:freelancers(*)")
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (contratoErr || !contratoRaw) {
    return NextResponse.json(
      { error: "Contrato não encontrado" },
      { status: 404 },
    );
  }

  const freelancer = (contratoRaw as any).freelancer as Freelancer | null;
  if (!freelancer) {
    return NextResponse.json(
      { error: "Freelancer vinculado não encontrado" },
      { status: 404 },
    );
  }

  // Regra UX: minuta exige pelo menos nome e CPF do freelancer
  if (!freelancer.nome_social || !freelancer.cpf) {
    return NextResponse.json(
      {
        error:
          "Freelancer precisa ter pelo menos nome social e CPF antes de gerar a minuta",
      },
      { status: 422 },
    );
  }

  const contrato = contratoRaw as FreelancerContrato;

  let buffer: Buffer;
  try {
    buffer = await gerarFreelancerContratoDocx({ freelancer, contrato });
  } catch (err) {
    console.error("[contrato.gerar-minuta]", err);
    return NextResponse.json(
      { error: "Falha ao gerar DOCX" },
      { status: 500 },
    );
  }

  const path = `${session.activeTenant.id}/contratos/${contrato.id}/minuta.docx`;
  const { error: uploadErr } = await supabase.storage
    .from("freelancer-arquivos")
    .upload(path, buffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });

  if (uploadErr) {
    console.error("[contrato.gerar-minuta.upload]", uploadErr.message);
    return NextResponse.json(
      { error: `Falha no upload: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  const { error: updateErr } = await supabase
    .from("freelancer_contratos")
    .update({ minuta_url: path, updated_by: session.profile.id })
    .eq("id", contrato.id)
    .eq("tenant_id", session.activeTenant.id);

  if (updateErr) {
    console.error("[contrato.gerar-minuta.update]", updateErr.message);
    return NextResponse.json(
      { error: `Falha ao atualizar contrato: ${updateErr.message}` },
      { status: 500 },
    );
  }

  await logAuditEvent({
    acao: "freelancer_contrato.minuta_gerada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_contrato",
    entidadeId: contrato.id,
    metadata: { path },
  });

  return NextResponse.json({ ok: true, path });
}
