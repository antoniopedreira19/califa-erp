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
  const { error } = await supabase
    .from("freelancer_contratos")
    .update({
      distrato_data_proposta: parsed.data.data_proposta,
      distrato_motivo: parsed.data.motivo,
      distrato_solicitado_por: session.profile.id,
      distrato_solicitado_em: new Date().toISOString(),
      // Zera minuta/assinado anteriores em caso de nova solicitação
      distrato_minuta_url: null,
      distrato_arquivo_url: null,
      updated_by: session.profile.id,
    })
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[distrato.solicitar]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
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
