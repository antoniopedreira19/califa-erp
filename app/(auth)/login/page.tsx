"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  AlertCircle,
  ShieldCheck,
  Wallet,
  LayoutList,
} from "lucide-react";

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginContent />
    </React.Suspense>
  );
}

function reasonToMessage(reason: string | null): string | null {
  switch (reason) {
    case "inativo":
      return "Sua conta está desativada. Fale com um administrador.";
    case "sem_tenant":
      return "Você ainda não tem acesso ao ERP. Peça a um administrador para liberar seu usuário.";
    default:
      return null;
  }
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [email, setEmail] = React.useState("");
  const [senha, setSenha] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(
    reasonToMessage(searchParams.get("reason")),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setLoading(true);

    const { data: signInData, error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    });

    if (error || !signInData.user) {
      setErro("E-mail ou senha incorretos.");
      setLoading(false);
      return;
    }

    // Bloqueia conta inativa imediatamente (RLS permite o próprio profile).
    const { data: profile } = await supabase
      .from("profiles")
      .select("ativo")
      .eq("id", signInData.user.id)
      .maybeSingle();

    if (profile && profile.ativo === false) {
      await supabase.auth.signOut();
      setErro("Sua conta está desativada. Fale com um administrador.");
      setLoading(false);
      return;
    }

    // Auditoria de login (RPC valida auth.uid()).
    await supabase.rpc("log_audit_event", {
      p_acao: "auth.login",
      p_tenant_id: null,
      p_entidade_tipo: null,
      p_entidade_id: signInData.user.id,
      p_metadata: {},
    });

    router.push("/home");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* ============================================
          BRAND SIDE — desktop only
          ============================================ */}
      <div className="hidden lg:flex lg:w-[55%] xl:w-1/2 relative bg-california-dark text-white overflow-hidden">
        <div
          className="absolute -top-40 -left-40 h-[28rem] w-[28rem] rounded-full bg-california-red/25 blur-[120px]"
          aria-hidden
        />
        <div
          className="absolute top-1/3 -right-32 h-96 w-96 rounded-full bg-california-red/15 blur-[100px]"
          aria-hidden
        />
        <div
          className="absolute -bottom-40 left-1/3 h-96 w-96 rounded-full bg-california-red/20 blur-[110px]"
          aria-hidden
        />

        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
          aria-hidden
        />
        <div
          className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/30 to-transparent"
          aria-hidden
        />

        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full animate-in fade-in duration-700">
          <div className="flex items-center gap-4">
            <div className="relative flex h-14 w-14 items-center justify-center">
              <div
                className="absolute inset-0 rounded-2xl bg-california-red/25 blur-xl"
                aria-hidden
              />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-california-red text-white text-lg font-bold shadow-brand">
                CA
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
                Agência
              </p>
              <h1 className="text-xl font-bold tracking-tight leading-none mt-0.5">
                California
              </h1>
            </div>
          </div>

          <div className="space-y-7 max-w-md animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-200 fill-mode-both">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 backdrop-blur px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-california-red opacity-75 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-california-red" />
              </span>
              Sistema interno · ERP
            </div>

            <div className="space-y-4">
              <h2 className="text-4xl xl:text-5xl font-bold leading-[1.05] tracking-tight text-balance">
                Do orçamento{" "}
                <span className="relative inline-block">
                  <span className="relative z-10">ao job</span>
                  <span
                    className="absolute -bottom-1 left-0 right-0 h-3 bg-california-red/40 -z-0 -skew-x-6"
                    aria-hidden
                  />
                </span>
                , sem perder o fio.
              </h2>
              <p className="text-base text-white/65 text-balance leading-relaxed">
                Um só lugar para criar orçamentos, versionar propostas,
                aprovar valores e abrir jobs com rastreabilidade.
              </p>
            </div>

            <ul className="space-y-3 pt-2">
              <Feature
                icon={LayoutList}
                text="Orçamentos comerciais com versões controladas"
              />
              <Feature
                icon={Wallet}
                text="Aprovação da versão gera o job automaticamente"
              />
              <Feature
                icon={ShieldCheck}
                text="Multi-tenant seguro com auditoria de ponta a ponta"
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
        <div
          className="absolute top-0 right-0 h-64 w-64 rounded-full bg-california-red/[0.04] blur-3xl"
          aria-hidden
        />

        <div className="relative w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-700">
          {/* Brand mobile */}
          <div className="lg:hidden mb-10 flex items-center gap-3">
            <div className="relative flex h-12 w-12 items-center justify-center">
              <div
                className="absolute inset-0 rounded-xl bg-california-red/20 blur-lg"
                aria-hidden
              />
              <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-california-red text-white text-sm font-bold">
                CA
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Agência
              </p>
              <h1 className="text-lg font-bold tracking-tight leading-none mt-0.5">
                California
              </h1>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
              Acesso ao ERP
            </p>
            <h2 className="text-3xl xl:text-4xl font-bold tracking-tight text-foreground">
              Bem-vindo de volta
            </h2>
            <p className="text-sm text-muted-foreground">
              Entre com suas credenciais para continuar.
            </p>
          </div>

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
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha"
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
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
                  Entrando...
                </>
              ) : (
                <>
                  Entrar no sistema
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          <div className="mt-10 pt-6 border-t border-border">
            <p className="text-center text-[11px] text-muted-foreground">
              Acesso restrito · Solicite a um administrador a criação da sua conta
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
