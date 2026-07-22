import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Callback de auth do Supabase.
 *
 * Suporta dois fluxos:
 *
 * 1. OAuth / magic-link PKCE tradicional: `?code=...&next=...`
 *    → `exchangeCodeForSession(code)`.
 *
 * 2. Links de e-mail customizados que passam pelo nosso domínio:
 *    `?token_hash=...&type=invite|signup|recovery|email_change&next=...`
 *    → `verifyOtp({ type, token_hash })`.
 *    Esse é o formato usado pelo template de convite: em vez de mandar o
 *    usuário pro domínio do Supabase e depois pro Site URL, mandamos ele
 *    direto pra cá com `next=/definir-senha` embutido — isso permite
 *    escolher o destino final por template sem depender do Site URL global.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/home";

  const supabase = createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) {
      const failUrl = new URL("/login", url.origin);
      failUrl.searchParams.set("reason", "convite_expirado");
      return NextResponse.redirect(failUrl);
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const failUrl = new URL("/login", url.origin);
      failUrl.searchParams.set("reason", "convite_expirado");
      return NextResponse.redirect(failUrl);
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
