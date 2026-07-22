"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const SENHA_MIN = 8;

export default function DefinirSenhaPage() {
  return (
    <React.Suspense fallback={null}>
      <DefinirSenhaContent />
    </React.Suspense>
  );
}

function DefinirSenhaContent() {
  const router = useRouter();
  const supabase = createClient();

  const [checandoSessao, setChecandoSessao] = React.useState(true);
  const [sessaoOk, setSessaoOk] = React.useState(false);
  const [emailUsuario, setEmailUsuario] = React.useState<string | null>(null);

  const [senha, setSenha] = React.useState("");
  const [confirma, setConfirma] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [sucesso, setSucesso] = React.useState(false);

  React.useEffect(() => {
    let ativo = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!ativo) return;
      if (!user) {
        // Sem sessão: link expirou ou nunca foi consumido. Manda para login.
        router.replace("/login?reason=convite_expirado");
        return;
      }
      setEmailUsuario(user.email ?? null);
      setSessaoOk(true);
      setChecandoSessao(false);
    })();
    return () => {
      ativo = false;
    };
  }, [router, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (senha.length < SENHA_MIN) {
      setErro(`A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`);
      return;
    }
    if (senha !== confirma) {
      setErro("As senhas não coincidem.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password: senha });

    if (error) {
      setErro(
        error.message.toLowerCase().includes("session")
          ? "Sua sessão expirou. Volte ao e-mail e clique no link novamente."
          : "Não foi possível salvar sua senha. Tente novamente.",
      );
      setLoading(false);
      return;
    }

    setSucesso(true);

    // Pequeno delay para o usuário ver a confirmação antes do redirect.
    setTimeout(() => {
      router.push("/home");
      router.refresh();
    }, 900);
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
              Ativação de conta
            </div>

            <div className="space-y-4">
              <h2 className="font-display text-4xl xl:text-5xl font-semibold leading-[1.05] tracking-tight text-balance">
                Bem-vindo ao{" "}
                <span className="relative inline-block">
                  <span className="relative z-10 italic">time</span>
                  <span
                    className="absolute -bottom-1 left-0 right-0 h-3 bg-california-red/40 -z-0 -skew-x-6"
                    aria-hidden
                  />
                </span>
                .
              </h2>
              <p className="text-base text-white/70 text-balance leading-relaxed">
                Defina sua senha de acesso para começar a usar o California ERP.
              </p>
            </div>

            <ul className="space-y-3 pt-2">
              <Feature
                icon={ShieldCheck}
                text="Sua senha fica salva apenas no Supabase Auth"
              />
              <Feature
                icon={KeyRound}
                text={`Mínimo de ${SENHA_MIN} caracteres — capriche na força`}
              />
              <Feature
                icon={Sparkles}
                text="Nos próximos acessos, entre pelo login normalmente"
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
              Ativação de conta
            </p>
            <h2 className="font-display text-3xl xl:text-4xl font-semibold tracking-tight text-foreground">
              Defina sua senha
            </h2>
            <p className="text-sm text-muted-foreground">
              {emailUsuario ? (
                <>
                  Você está ativando o acesso de{" "}
                  <span className="font-medium text-foreground">{emailUsuario}</span>.
                </>
              ) : (
                <>Crie uma senha para acessar o California ERP.</>
              )}
            </p>
          </div>

          {checandoSessao ? (
            <div className="mt-9 flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              <span className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
              Validando seu convite...
            </div>
          ) : sessaoOk ? (
            <form onSubmit={handleSubmit} className="mt-9 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="senha">Senha</Label>
                <Input
                  id="senha"
                  type="password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                  minLength={SENHA_MIN}
                  disabled={loading || sucesso}
                />
                <p className="text-[11px] text-muted-foreground">
                  Mínimo de {SENHA_MIN} caracteres.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirma">Confirmar senha</Label>
                <Input
                  id="confirma"
                  type="password"
                  value={confirma}
                  onChange={(e) => setConfirma(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                  minLength={SENHA_MIN}
                  disabled={loading || sucesso}
                />
              </div>

              {erro && (
                <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red animate-in fade-in slide-in-from-top-1 duration-300">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{erro}</span>
                </div>
              )}

              {sucesso && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 animate-in fade-in slide-in-from-top-1 duration-300">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>Senha definida! Redirecionando...</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || sucesso}
                className="group relative w-full inline-flex items-center justify-center gap-2 rounded-xl bg-california-red px-6 py-3.5 text-sm font-semibold text-white shadow-brand transition-all hover:bg-california-red-hover hover:shadow-[0_12px_40px_-8px_rgba(231,75,86,0.5)] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:shadow-brand"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Salvando...
                  </>
                ) : sucesso ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Pronto
                  </>
                ) : (
                  <>
                    Ativar minha conta
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>
          ) : null}

          <div className="mt-10 pt-6 border-t border-border">
            <p className="text-center text-[11px] text-muted-foreground">
              Problemas para ativar? Fale com o administrador do sistema.
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
