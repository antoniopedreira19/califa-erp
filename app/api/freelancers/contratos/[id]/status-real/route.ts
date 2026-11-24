import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

export const dynamic = "force-dynamic";

const PODE_EDITAR_SEMPRE = new Set(["administrador", "rh", "financeiro"]);

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  let body: { status_real?: unknown; motivo?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (typeof body.status_real !== "boolean") {
    return NextResponse.json(
      { error: "Campo status_real precisa ser true ou false" },
      { status: 400 },
    );
  }
  const novoStatus = body.status_real;
  const motivo =
    typeof body.motivo === "string" && body.motivo.trim().length > 0
      ? body.motivo.trim().slice(0, 500)
      : null;

  const supabase = createClient();

  // Lê o contrato pra validar existência, tenant e permissão (responsável).
  const { data: contratoAtual, error: contratoErr } = await supabase
    .from("freelancer_contratos")
    .select("id, status_real, responsavel_id")
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (contratoErr || !contratoAtual) {
    return NextResponse.json(
      { error: "Contrato não encontrado" },
      { status: 404 },
    );
  }

  const ehResponsavel =
    (contratoAtual as { responsavel_id: string | null }).responsavel_id ===
    session.profile.id;
  if (!PODE_EDITAR_SEMPRE.has(session.activeRole) && !ehResponsavel) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const statusAtual = (contratoAtual as { status_real: boolean | null })
    .status_real;
  if (statusAtual === novoStatus) {
    return NextResponse.json({ ok: true, inalterado: true });
  }

  // O trigger trg_freelancer_contrato_historico grava a mudança de status_real
  // automaticamente. O motivo (texto livre) vai pro audit — histórico do
  // contrato é imutável e enumera campos; não cabe texto livre lá.
  const { data: atualizados, error: updErr } = await supabase
    .from("freelancer_contratos")
    .update({
      status_real: novoStatus,
      updated_by: session.profile.id,
    })
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .select("id");

  if (updErr) {
    console.error("[contrato.status-real]", updErr.message);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  if (!atualizados || atualizados.length === 0) {
    return NextResponse.json(
      {
        error:
          "Não foi possível atualizar o contrato. Verifique se você tem permissão.",
      },
      { status: 403 },
    );
  }

  await logAuditEvent({
    acao: novoStatus
      ? "freelancer_contrato.status_real_reaberto"
      : "freelancer_contrato.status_real_encerrado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_contrato",
    entidadeId: params.id,
    metadata: {
      status_real_anterior: statusAtual,
      status_real_novo: novoStatus,
      ...(motivo ? { motivo } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
