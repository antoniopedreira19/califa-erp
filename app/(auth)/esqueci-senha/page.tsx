"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  MailCheck,
  ShieldCheck,
  Clock,
} from "lucide-react";

export default function EsqueciSenhaPage() {
  return (
    <React.Suspense fallback={null}>
      <EsqueciSenhaContent />
    </React.Suspense>
  );
}

function EsqueciSenhaContent() {
  const supabase = createClient();

  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [enviado, setEnviado] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setLoading(true);

    const redirectTo = `${window.location.origin}/api/auth/callback?next=/resetar-senha`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    // Não expõe existência da conta: mesma resposta para sucesso/erro genérico.
    // Só quebra o silêncio em erros de rede/rate-limit que o usuário precisa ver.
    if (error && error.status === 429) {
      setErro("Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.");
      setLoading(false);
      return;
    }

    setEnviado(true);
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* ============================================
          BRAND SIDE — desktop only
          ============================================ */}
      <div className="hidden lg:flex lg:w-[55%] xl:w-1/2 relative bg-california-dark text-white overflow-hidden">
        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full animate-in fade-in duration-700">
          <div className="flex items-center gap-5">
            <Image
              src="/brand/logo-icon.png"
              alt="Agência California"
              width={80}
              height={80}
              priority
              className="h-20 w-20 object-contain shrink-0"
            />
            <h1 className="font-display text-3xl xl:text-4xl font-semibold tracking-tight leading-none whitespace-nowrap">
              Agência California
            </h1>
          </div>

          <div className="space-y-7 max-w-md animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-200 fill-mode-both">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 backdrop-blur px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-california-red opacity-75 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-california-red" />
              </span>
              Recuperação de acesso
            </div>

            <div className="space-y-4">
              <h2 className="font-display text-4xl xl:text-5xl font-semibold leading-[1.05] tracking-tight text-balance">
                Sem drama.{" "}
                <span className="relative inline-block">
                  <span className="relative z-10 italic">Enviamos</span>
                  <span
                    className="absolute -bottom-1 left-0 right-0 h-3 bg-california-red/40 -z-0 -skew-x-6"
                    aria-hidden
                  />
                </span>{" "}
                um link.
              </h2>
              <p className="text-base text-white/70 text-balance leading-relaxed">
                Informe o e-mail cadastrado e você receberá um link seguro para criar uma nova senha.
              </p>
            </div>

            <ul className="space-y-3 pt-2">
              <Feature
                icon={MailCheck}
                text="Chegou um link no seu e-mail — clique para abrir a tela de nova senha"
              />
              <Feature
                icon={Clock}
                text="Link válido por tempo limitado e pode ser usado só uma vez"
              />
              <Feature
                icon={ShieldCheck}
                text="Sua senha atual continua valendo até você definir uma nova"
              />
            </ul>
          </div>

          <div className="flex items-center justify-between text-[11px] text-white/40">
            <p>© {new Date().getFullYear()} Agência California</p>
            <p className="tracking-wide">ERP · v0.1</p>
          </div>
        </div>
      </div>

      {/* ============================================
          FORM SIDE
          ============================================ */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 relative">
        <div className="relative w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-700">
          {/* Brand mobile */}
          <div className="lg:hidden mb-10 flex items-center gap-3">
            <Image
              src="/brand/logo-icon.png"
              alt="Agência California"
              width={56}
              height={56}
              priority
              className="h-14 w-14 object-contain shrink-0"
            />
            <h1 className="font-display text-2xl font-semibold tracking-tight leading-none whitespace-nowrap">
              Agência California
            </h1>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
              Recuperação de acesso
            </p>
            <h2 className="font-display text-3xl xl:text-4xl font-semibold tracking-tight text-foreground">
              Esqueceu a senha?
            </h2>
            <p className="text-sm text-muted-foreground">
              Informe seu e-mail e enviaremos um link para redefinir.
            </p>
          </div>

          {enviado ? (
            <div className="mt-9 space-y-5">
              <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-4 text-sm text-emerald-800">
                <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0 text-emerald-600" />
                <div className="space-y-1">
                  <p className="font-medium">Se o e-mail estiver cadastrado, o link foi enviado.</p>
                  <p className="text-emerald-800/80">
                    Verifique sua caixa de entrada (e o spam) e siga as instruções para criar uma nova senha.
                  </p>
                </div>
              </div>

              <Link
                href="/login"
                className="group inline-flex items-center gap-2 text-sm font-medium text-california-red hover:text-california-red-hover transition-colors"
              >
                <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
                Voltar para o login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-9 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="voce@agenciacalifornia.com.br"
                  disabled={loading}
                />
              </div>

              {erro && (
                <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red animate-in fade-in slide-in-from-top-1 duration-300">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{erro}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="group relative w-full inline-flex items-center justify-center gap-2 rounded-xl bg-california-red px-6 py-3.5 text-sm font-semibold text-white shadow-brand transition-all hover:bg-california-red-hover hover:shadow-[0_12px_40px_-8px_rgba(231,75,86,0.5)] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:shadow-brand"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    Enviar link de recuperação
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>

              <div className="pt-2">
                <Link
                  href="/login"
                  className="group inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
                  Voltar para o login
                </Link>
              </div>
            </form>
          )}

          <div className="mt-10 pt-6 border-t border-border">
            <p className="text-center text-[11px] text-muted-foreground">
              Ainda com problemas? Fale com o administrador do sistema.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Feature({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <li className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] border border-white/[0.08] backdrop-blur shrink-0">
        <Icon className="h-4 w-4 text-california-red" />
      </div>
      <span className="text-sm text-white/80 font-medium">{text}</span>
    </li>
  );
}
