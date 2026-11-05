import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

export const dynamic = "force-dynamic";

/**
 * Cancela o pedido de distrato: zera campos de distrato E remove os
 * arquivos do bucket se existirem. Se o distrato já foi aplicado
 * (status_real = false por causa de distrato), **não desfaz** —
 * aplicar/desaplicar é operação pontual, não reversível aqui.
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

  const supabase = createClient();

  // Chama RPC SECURITY DEFINER (mesmo motivo que em /solicitar). A RPC
  // valida permissão (admin/rh/fin, OU responsável do contrato, OU quem
  // solicitou o distrato) e devolve os paths dos arquivos pra API apagar
  // do bucket. Ver migration 20261105100001.
  const { data: paths, error } = await supabase.rpc(
    "cancelar_distrato_contrato",
    { p_contrato_id: params.id },
  );

  if (error) {
    console.error("[distrato.cancelar]", error.message);
    const codigoDeNegocio = /^P000[1-3]$/.test(error.code ?? "");
    return NextResponse.json(
      { error: error.message },
      { status: codigoDeNegocio ? 403 : 500 },
    );
  }

  // Best-effort: apaga arquivos do bucket
  if (Array.isArray(paths) && paths.length > 0) {
    await supabase.storage.from("freelancer-arquivos").remove(paths);
  }

  await logAuditEvent({
    acao: "freelancer_contrato.distrato_cancelado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer_contrato",
    entidadeId: params.id,
  });

  return NextResponse.json({ ok: true });
}
