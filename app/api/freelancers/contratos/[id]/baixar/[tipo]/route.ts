import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TIPOS_VALIDOS = new Set(["minuta", "assinado"]);
const EXPIRA_EM_SEG = 60 * 60; // 1 hora

/**
 * GET /api/freelancers/contratos/[id]/baixar/[tipo]
 *
 * tipo ∈ (minuta, assinado). Resolve o path, cria signed URL e redireciona.
 * Qualquer tenant_member pode baixar (RLS do bucket + leitura do contrato).
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string; tipo: string } },
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  if (!TIPOS_VALIDOS.has(params.tipo)) {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }

  const supabase = createClient();
  const { data: contrato, error } = await supabase
    .from("freelancer_contratos")
    .select("minuta_url, arquivo_url")
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (error || !contrato) {
    return NextResponse.json(
      { error: "Contrato não encontrado" },
      { status: 404 },
    );
  }

  const path =
    params.tipo === "minuta"
      ? (contrato as any).minuta_url
      : (contrato as any).arquivo_url;

  if (!path) {
    return NextResponse.json(
      { error: `Nenhuma ${params.tipo} disponível neste contrato` },
      { status: 404 },
    );
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from("freelancer-arquivos")
    .createSignedUrl(path, EXPIRA_EM_SEG);

  if (signErr || !signed) {
    console.error("[contrato.baixar.signed]", signErr?.message);
    return NextResponse.json(
      { error: "Falha ao gerar link de download" },
      { status: 500 },
    );
  }

  return NextResponse.redirect(signed.signedUrl);
}
