import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Baixa o PDF da contratação (gerado ou assinado) pelo RH. Autenticação
 * pelo cookie de sessão + RLS. Retorna o binário diretamente.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string; tipo: string } },
) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    return NextResponse.json({ error: "sem_permissao" }, { status: 403 });
  }
  if (params.tipo !== "gerado" && params.tipo !== "assinado") {
    return NextResponse.json({ error: "tipo_invalido" }, { status: 400 });
  }

  const supabase = createClient();
  const { data: c } = await supabase
    .from("contratacoes")
    .select("id, contrato_gerado_path, contrato_assinado_path")
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!c) {
    return NextResponse.json({ error: "nao_encontrada" }, { status: 404 });
  }
  const path =
    params.tipo === "gerado"
      ? c.contrato_gerado_path
      : c.contrato_assinado_path;
  if (!path) {
    return NextResponse.json({ error: "arquivo_ausente" }, { status: 404 });
  }

  const { data: blob, error } = await supabase.storage
    .from("contratacoes-anexos")
    .download(path);
  if (error || !blob) {
    return NextResponse.json({ error: "falha_download" }, { status: 500 });
  }
  const buffer = Buffer.from(await blob.arrayBuffer());
  const filename = `contrato-${params.tipo}-${params.id.slice(0, 8)}.pdf`;
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-cache",
    },
  });
}
