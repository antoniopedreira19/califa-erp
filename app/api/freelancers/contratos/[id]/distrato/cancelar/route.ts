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

  // Buscar paths pra deletar do bucket
  const { data: c } = await supabase
    .from("freelancer_contratos")
    .select("distrato_minuta_url, distrato_arquivo_url")
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  const paths: string[] = [];
  const minutaPath = (c as any)?.distrato_minuta_url;
  const assinadoPath = (c as any)?.distrato_arquivo_url;
  if (minutaPath) paths.push(minutaPath);
  if (assinadoPath) paths.push(assinadoPath);

  // `select("id")` pra diferenciar 0 linhas (RLS/not-found) de sucesso real.
  // Mesmo padrão do solicitar/route — sem isso, API devolvia 200 pra tentativas
  // bloqueadas por RLS e o audit de cancelado era gravado em vão.
  const { data: atualizados, error } = await supabase
    .from("freelancer_contratos")
    .update({
      distrato_data_proposta: null,
      distrato_motivo: null,
      distrato_solicitado_por: null,
      distrato_solicitado_em: null,
      distrato_minuta_url: null,
      distrato_arquivo_url: null,
      updated_by: session.profile.id,
    })
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .select("id");

  if (error) {
    console.error("[distrato.cancelar]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!atualizados || atualizados.length === 0) {
    console.error(
      "[distrato.cancelar] 0 linhas afetadas — RLS bloqueou ou contrato não existe",
      { contrato_id: params.id, user_id: session.profile.id },
    );
    return NextResponse.json(
      {
        error:
          "Não foi possível cancelar o distrato. Verifique se você tem permissão nesse contrato.",
      },
      { status: 403 },
    );
  }

  // Best-effort: apaga arquivos do bucket
  if (paths.length > 0) {
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
