import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import type { Freelancer, FreelancerContrato } from "@/lib/types";
import { gerarFreelancerDistratoDocx } from "@/lib/freelancer-distrato-docx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PODE_GERAR = new Set(["administrador", "rh", "financeiro"]);

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

  const contrato = contratoRaw as FreelancerContrato;
  if (!contrato.distrato_data_proposta) {
    return NextResponse.json(
      { error: "Solicite o distrato antes de gerar a minuta" },
      { status: 422 },
    );
  }

  let buffer: Buffer;
  try {
    buffer = await gerarFreelancerDistratoDocx({ freelancer, contrato });
  } catch (err) {
    console.error("[distrato.gerar-minuta]", err);
    return NextResponse.json(
      { error: "Falha ao gerar DOCX" },
      { status: 500 },
    );
  }

  const path = `${session.activeTenant.id}/contratos/${contrato.id}/distrato-minuta.docx`;
  const { error: upErr } = await supabase.storage
    .from("freelancer-arquivos")
    .upload(path, buffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });

  if (upErr) {
    return NextResponse.json(
      { error: `Falha no upload: ${upErr.message}` },
      { status: 500 },
    );
  }

  const { error: updErr } = await supabase
    .from("freelancer_contratos")
    .update({ distrato_minuta_url: path, updated_by: session.profile.id })
    .eq("id", contrato.id)
    .eq("tenant_id", session.activeTenant.id);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await logAuditEvent({
    acao: "freelancer_contrato.distrato_minuta_gerada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_contrato",
    entidadeId: contrato.id,
    metadata: { path },
  });

  return NextResponse.json({ ok: true, path });
}
