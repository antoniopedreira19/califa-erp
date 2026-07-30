"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

export const SENHA_MIN = 8;

type FormNovaSenhaProps = {
  /**
   * Motivo do redirect para /login quando a sessão do link não é válida
   * (link expirado ou já usado).
   */
  reasonSemSessao: string;
  /** Rótulo do botão em estado ocioso. */
  labelBotao: string;
  /** Texto do banner de sucesso antes do redirect. */
  labelSucesso: string;
  /** Rota destino após sucesso. */
  destinoAposSucesso: string;
  /** Ação de auditoria a registrar após updateUser. Opcional. */
  acaoAuditoria?: string;
  /**
   * Render prop opcional: recebe o email do usuário autenticado (após
   * verifyOtp) para eventual exibição no cabeçalho da página.
   */
  onEmailCarregado?: (email: string | null) => void;
};

export function FormNovaSenha({
  reasonSemSessao,
  labelBotao,
  labelSucesso,
  destinoAposSucesso,
  acaoAuditoria,
  onEmailCarregado,
}: FormNovaSenhaProps) {
  const router = useRouter();
  const supabase = createClient();

  const [checandoSessao, setChecandoSessao] = React.useState(true);
  const [sessaoOk, setSessaoOk] = React.useState(false);

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
        router.replace(`/login?reason=${reasonSemSessao}`);
        return;
      }
      onEmailCarregado?.(user.email ?? null);
      setSessaoOk(true);
      setChecandoSessao(false);
    })();
    return () => {
      ativo = false;
    };
  }, [router, supabase, reasonSemSessao, onEmailCarregado]);

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

    const { data, error } = await supabase.auth.updateUser({ password: senha });

    if (error) {
      setErro(
        error.message.toLowerCase().includes("session")
          ? "Sua sessão expirou. Volte ao e-mail e clique no link novamente."
          : "Não foi possível salvar sua senha. Tente novamente.",
      );
      setLoading(false);
      return;
    }

    if (acaoAuditoria && data.user) {
      await supabase.rpc("log_audit_event", {
        p_acao: acaoAuditoria,
        p_tenant_id: null,
        p_entidade_tipo: null,
        p_entidade_id: data.user.id,
        p_metadata: {},
      });
    }

    setSucesso(true);

    setTimeout(() => {
      router.push(destinoAposSucesso);
      router.refresh();
    }, 900);
  }

  if (checandoSessao) {
    return (
      <div className="mt-9 flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <span className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
        Validando seu link...
      </div>
    );
  }

  if (!sessaoOk) return null;

  return (
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
          <span>{labelSucesso}</span>
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
            {labelBotao}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </>
        )}
      </button>
    </form>
  );
}
