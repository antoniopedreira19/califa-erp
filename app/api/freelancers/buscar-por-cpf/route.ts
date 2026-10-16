import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import { onlyDigits, isValidCpf } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/freelancers/buscar-por-cpf?cpf=<cpf com ou sem máscara>
 *
 * Retorna o freelancer encontrado no tenant ativo ou null. Serve pra UI
 * avisar duplicata antes de criar/editar — não é fonte-verdade: a RLS e a
 * unique index no banco ainda são a trava real.
 *
 * Só autenticados do tenant. Params inválidos devolvem 400.
 */
export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  if (!pode(session.activeRole, "sidebar.freelancers")) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const cpfBruto = searchParams.get("cpf") ?? "";
  const cpf = onlyDigits(cpfBruto);

  if (cpf.length !== 11 || !isValidCpf(cpf)) {
    return NextResponse.json({ error: "CPF inválido" }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("freelancers")
    .select("id, nome_social")
    .eq("tenant_id", session.activeTenant.id)
    .eq("cpf", cpf)
    .maybeSingle();

  if (error) {
    console.error("[api.freelancers.buscar-por-cpf]", error.message);
    return NextResponse.json({ error: "Erro ao consultar" }, { status: 500 });
  }

  return NextResponse.json({ encontrado: data ?? null });
}
