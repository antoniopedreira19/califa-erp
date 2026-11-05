import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { solicitarDistratoSchema } from "@/lib/validations/freelancer-distrato";

export const dynamic = "force-dynamic";

/** POST — qualquer tenant_member com acesso ao contrato pode solicitar. */
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

  const formData = await request.formData();
  const parsed = solicitarDistratoSchema.safeParse({
    data_proposta: formData.get("data_proposta")?.toString() ?? "",
    motivo: formData.get("motivo")?.toString() ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Dados inválidos",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 422 },
    );
  }

  const supabase = createClient();
  // Chama RPC SECURITY DEFINER em vez de UPDATE direto: a policy RLS de
  // freelancer_contratos só libera UPDATE pra admin/rh/financeiro. GP
  // (responsável do contrato) precisa passar pela RPC pra o UPDATE rolar.
  // A RPC valida: admin/rh/fin OU responsavel_id = auth.uid().
  // Ver incidente Adriano/Márcia (05/11/2026) e migration 20261105100001.
  const { error } = await supabase.rpc("solicitar_distrato_contrato", {
    p_contrato_id: params.id,
    p_data_proposta: parsed.data.data_proposta,
    p_motivo: parsed.data.motivo,
  });

  if (error) {
    console.error("[distrato.solicitar]", error.message);
    // Erros de permissão/validação vêm como P0001..P0005 da RPC.
    const codigoDeNegocio = /^P000[1-5]$/.test(error.code ?? "");
    return NextResponse.json(
      { error: error.message },
      { status: codigoDeNegocio ? 403 : 500 },
    );
  }

  await logAuditEvent({
    acao: "freelancer_contrato.distrato_solicitado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_contrato",
    entidadeId: params.id,
    metadata: {
      data_proposta: parsed.data.data_proposta,
      motivo: parsed.data.motivo,
    },
  });

  return NextResponse.json({ ok: true });
}
