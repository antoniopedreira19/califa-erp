import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware de sessão: renova cookies do Supabase e bloqueia rotas
 * privadas para usuários sem sessão. NÃO checa perfil/ativo/vínculo
 * com tenant aqui — esse check acontece nos server components
 * (lib/auth/session.ts) porque exige round-trip ao Postgres.
 */
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  const isPublicRoute =
    path === "/login" ||
    path === "/esqueci-senha" ||
    path === "/resetar-senha" ||
    path === "/definir-senha" ||
    path.startsWith("/api/auth/") ||
    path.startsWith("/_next") ||
    path.startsWith("/favicon");

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANTE: nunca coloque lógica entre createServerClient() e
  // supabase.auth.getUser(). getUser() revalida o token via Auth API e
  // renova cookies quando necessário — qualquer código no meio pode ficar
  // com uma sessão stale.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
