"use client";

import * as React from "react";
import { CheckCircle2, RefreshCw, UserCheck, UserX } from "lucide-react";
import { alterarStatusMembership, type ActionResult } from "./actions";

type Estado = "idle" | "enviando" | "sucesso" | "erro";

export function AlterarStatusButton({
  userId,
  userNome,
  statusAtual,
}: {
  userId: string;
  userNome: string;
  statusAtual: "ativo" | "inativo";
}) {
  const [estado, setEstado] = React.useState<Estado>("idle");
  const [mensagem, setMensagem] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  const proximoStatus: "ativo" | "inativo" =
    statusAtual === "ativo" ? "inativo" : "ativo";

  function handleClick() {
    if (estado === "enviando" || estado === "sucesso") return;

    if (proximoStatus === "inativo") {
      const ok = window.confirm(
        `${userNome} vai perder acesso ao California ERP. ` +
          "Você pode reativar a qualquer momento. Continuar?",
      );
      if (!ok) return;
    }

    setEstado("enviando");
    setMensagem(null);
    startTransition(async () => {
      const res: ActionResult = await alterarStatusMembership(
        userId,
        proximoStatus,
      );
      if (res.ok) {
        setEstado("sucesso");
        setMensagem(res.message ?? null);
        // Não precisa timer — o revalidatePath vai re-renderizar a lista
        // e o botão vai voltar para o estado idle no novo status.
      } else {
        setEstado("erro");
        setMensagem(res.message);
        window.setTimeout(() => {
          setEstado("idle");
          setMensagem(null);
        }, 5000);
      }
    });
  }

  const disabled = estado === "enviando" || estado === "sucesso";
  const isInativar = proximoStatus === "inativo";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={
          isInativar
            ? "inline-flex items-center gap-1.5 rounded-lg border border-california-red/20 bg-white px-3 py-1.5 text-xs font-semibold text-california-red hover:bg-california-red/5 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            : "inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/5 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        }
      >
        {estado === "enviando" ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            {isInativar ? "Inativando..." : "Reativando..."}
          </>
        ) : estado === "sucesso" ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" />
            {isInativar ? "Inativado" : "Reativado"}
          </>
        ) : isInativar ? (
          <>
            <UserX className="h-3.5 w-3.5" />
            Inativar
          </>
        ) : (
          <>
            <UserCheck className="h-3.5 w-3.5" />
            Reativar
          </>
        )}
      </button>
      {estado === "erro" && mensagem && (
        <p className="text-[11px] text-california-red text-right max-w-[240px]">
          {mensagem}
        </p>
      )}
    </div>
  );
}
