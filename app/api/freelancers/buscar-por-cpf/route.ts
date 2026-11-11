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

  // RPC SECURITY DEFINER. SELECT direto em freelancers esbarra na RLS
  // que esconde cadastros fora da responsabilidade do GP — o form não
  // detectaria o freela cadastrado e a solicitação cairia como
  // "contratação" (incidente Matheus, 11/11/2026, migration
  // 20261111100004).
  const supabase = createClient();
  const { data, error } = await supabase.rpc("freelancer_buscar_por_cpf", {
    p_tenant_id: session.activeTenant.id,
    p_cpf: cpf,
  });

  if (error) {
    console.error("[api.freelancers.buscar-por-cpf]", error.message);
    return NextResponse.json({ error: "Erro ao consultar" }, { status: 500 });
  }

  const encontrado =
    Array.isArray(data) && data.length > 0
      ? { id: data[0].id as string, nome_social: data[0].nome_social as string }
      : null;

  return NextResponse.json({ encontrado });
}
