import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

/**
 * Logout server-side: registra evento de auditoria com o usuário ainda
 * autenticado, então desloga. Retorna redirect para /login.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await logAuditEvent({
      acao: "auth.logout",
      entidadeTipo: "user",
      entidadeId: user.id,
    });
  }

  await supabase.auth.signOut();

  const origin = new URL(request.url).origin;
  return NextResponse.redirect(new URL("/login", origin), { status: 303 });
}

// Permite chamada via GET em ambientes sem JS (raro; fallback seguro).
export async function GET(request: Request) {
  return POST(request);
}
