import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Gera signed upload URL pro contrato assinado. O browser sobe o PDF
 * DIRETO pro Supabase Storage — não passa pela Function serverless.
 *
 * Fluxo:
 *   1. POST aqui, validando sessão + permissão + status
 *   2. Client faz upload pro token retornado
 *   3. Client chama `finalizarAnexoContrato` pra gravar o path no DB
 *
 * Antes disso, o upload passava pela Function e cada MB dobrava:
 * browser -> Vercel -> Supabase. Contrato de 3 MB ficava em ~7s.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    return NextResponse.json({ error: "sem_permissao" }, { status: 403 });
  }

  const supabase = createClient();
  const { data: c } = await supabase
    .from("contratacoes")
    .select("id, status")
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!c) {
    return NextResponse.json({ error: "nao_encontrada" }, { status: 404 });
  }
  if (c.status !== "dados_completos" && c.status !== "contrato_gerado") {
    return NextResponse.json({ error: "status_invalido" }, { status: 400 });
  }

  const path = `${session.activeTenant.id}/${params.id}/contrato-assinado.pdf`;
  const { data, error } = await supabase.storage
    .from("contratacoes-anexos")
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    console.error("[rh.contratacao.upload_url]", error?.message);
    return NextResponse.json({ error: "falha_signed_url" }, { status: 500 });
  }

  return NextResponse.json({ path, token: data.token });
}
