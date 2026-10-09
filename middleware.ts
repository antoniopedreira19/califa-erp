import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image, favicon
     * - public assets (svg, png, jpg, etc)
     * - api/versao: a aba pergunta a versão a cada 5 min e não precisa de
     *   sessão (components/aviso-de-versao-nova.tsx)
     */
    "/((?!_next/static|_next/image|favicon.ico|api/versao|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
