"use client";

import * as React from "react";
import { CheckCircle2, RefreshCw, Send } from "lucide-react";
import { reenviarConvite, type ActionResult } from "./actions";

type Estado = "idle" | "enviando" | "sucesso" | "erro";

export function ReenviarConviteButton({ userId }: { userId: string }) {
  const [estado, setEstado] = React.useState<Estado>("idle");
  const [mensagem, setMensagem] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  function handleClick() {
    if (estado === "enviando") return;
    setEstado("enviando");
    setMensagem(null);
    startTransition(async () => {
      const res: ActionResult = await reenviarConvite(userId);
      if (res.ok) {
        setEstado("sucesso");
        setMensagem(res.message ?? "Convite reenviado.");
        window.setTimeout(() => {
          setEstado("idle");
          setMensagem(null);
        }, 3000);
      } else {
        setEstado("erro");
        setMensagem(res.message);
        window.setTimeout(() => {
          setEstado("idle");
          setMensagem(null);
        }, 4000);
      }
    });
  }

  const disabled = estado === "enviando" || estado === "sucesso";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-1.5 text-xs font-semibold text-california-red hover:bg-california-red/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {estado === "enviando" ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            Reenviando...
          </>
        ) : estado === "sucesso" ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" />
            Convite reenviado
          </>
        ) : (
          <>
            <Send className="h-3.5 w-3.5" />
            Reenviar convite
          </>
        )}
      </button>
      {estado === "erro" && mensagem && (
        <p className="text-[11px] text-california-red text-right max-w-[220px]">
          {mensagem}
        </p>
      )}
    </div>
  );
}
