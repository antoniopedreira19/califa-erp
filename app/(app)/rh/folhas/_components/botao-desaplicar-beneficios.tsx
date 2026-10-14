"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Undo2 } from "lucide-react";
import { desaplicarBeneficios } from "@/lib/actions/beneficios/fechamento";

export function BotaoDesaplicarBeneficios(props: { fechamentoId: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  function handleClick() {
    setErro(null);
    const texto = [
      "Desaplicar os descontos de benefícios desta competência?",
      "",
      "Isso vai:",
      "• Reverter a redução de salário nas linhas PJ.",
      "• Apagar as avulsas geradas (SulAmerica + Bradesco).",
      "• Marcar a competência como reaberta.",
      "",
      "Só funciona se nenhuma avulsa foi paga.",
    ].join("\n");
    if (!confirm(texto)) return;
    startTransition(async () => {
      const r = await desaplicarBeneficios({ fechamentoId: props.fechamentoId });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Undo2 className="h-3.5 w-3.5" />
        )}
        {pending ? "Desaplicando..." : "Desaplicar"}
      </button>
      {erro && (
        <p className="text-xs text-red-700 max-w-[280px] text-right">{erro}</p>
      )}
    </div>
  );
}
