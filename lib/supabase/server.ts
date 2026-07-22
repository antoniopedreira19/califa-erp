import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Server client vinculado à sessão do usuário atual (via cookies).
 * Respeita RLS. Use em Server Components, Server Actions e Route Handlers.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Chamada a partir de Server Component — cookie mutations
            // são reaplicadas pelo middleware via updateSession. Ignore.
          }
        },
      },
    },
  );
}

/**
 * Service client — bypassa RLS. NUNCA importar em código client-side.
 * Use apenas em Server Actions ou Route Handlers, e apenas quando
 * absolutamente necessário (ex: criar profile antes do primeiro login,
 * atribuir tenant_member ao admin inicial).
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
