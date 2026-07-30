"use client";

import * as React from "react";
import Image from "next/image";
import {
  KeyRound,
  ShieldCheck,
  LogIn,
} from "lucide-react";
import { FormNovaSenha, SENHA_MIN } from "@/components/auth/form-nova-senha";

export default function ResetarSenhaPage() {
  return (
    <React.Suspense fallback={null}>
      <ResetarSenhaContent />
    </React.Suspense>
  );
}

function ResetarSenhaContent() {
  const [emailUsuario, setEmailUsuario] = React.useState<string | null>(null);
  const handleEmailCarregado = React.useCallback((email: string | null) => {
    setEmailUsuario(email);
  }, []);

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
                Uma senha{" "}
                <span className="relative inline-block">
                  <span className="relative z-10 italic">nova</span>
                  <span
                    className="absolute -bottom-1 left-0 right-0 h-3 bg-california-red/40 -z-0 -skew-x-6"
                    aria-hidden
                  />
                </span>
                , só sua.
              </h2>
              <p className="text-base text-white/70 text-balance leading-relaxed">
                Escolha uma senha forte e volte a acessar o California ERP em segundos.
              </p>
            </div>

            <ul className="space-y-3 pt-2">
              <Feature
                icon={ShieldCheck}
                text="A senha antiga é descartada assim que a nova é salva"
              />
              <Feature
                icon={KeyRound}
                text={`Mínimo de ${SENHA_MIN} caracteres — capriche na força`}
              />
              <Feature
                icon={LogIn}
                text="Após redefinir, você já entra direto no sistema"
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
              Redefina sua senha
            </h2>
            <p className="text-sm text-muted-foreground">
              {emailUsuario ? (
                <>
                  Você está redefinindo a senha de{" "}
                  <span className="font-medium text-foreground">{emailUsuario}</span>.
                </>
              ) : (
                <>Escolha uma nova senha para voltar a acessar o California ERP.</>
              )}
            </p>
          </div>

          <FormNovaSenha
            reasonSemSessao="recuperacao_expirada"
            labelBotao="Redefinir senha"
            labelSucesso="Senha atualizada! Redirecionando..."
            destinoAposSucesso="/home"
            acaoAuditoria="auth.senha_redefinida"
            onEmailCarregado={handleEmailCarregado}
          />

          <div className="mt-10 pt-6 border-t border-border">
            <p className="text-center text-[11px] text-muted-foreground">
              Problemas para redefinir? Fale com o administrador do sistema.
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
