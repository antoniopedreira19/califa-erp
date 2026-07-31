"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cancelarAprovacaoVersao } from "../actions";

interface Props {
  versaoId: string;
  status: string;
  temJobAtivo: boolean;
}

/**
 * Sobrou só o desfazer. "Aprovar versão" mudou para a barra de ação do
 * rodapé no handoff "Abertura de Job.dc.html" — ver `FluxoAbertura`.
 */
export function AprovacaoActions({ versaoId, status, temJobAtivo }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmando, setConfirmando] = React.useState<"cancelar" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const podeCancelarAprovacao = status === "aprovada" && !temJobAtivo;

  function handleCancelar() {
    setError(null);
    startTransition(async () => {
      const res = await cancelarAprovacaoVersao(versaoId);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setConfirmando(null);
      router.refresh();
    });
  }

  if (!podeCancelarAprovacao) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmando("cancelar")}
        className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/40 bg-white px-3 py-1.5 text-xs font-semibold text-california-red hover:bg-california-red/5 transition-colors"
      >
        <Undo2 className="h-3.5 w-3.5" />
        Cancelar aprovação
      </button>

      <ConfirmDialog
        open={confirmando === "cancelar"}
        onOpenChange={(o) => !o && setConfirmando(null)}
        title="Cancelar a aprovação desta versão?"
        description="A versão volta pra 'em revisão'. As versões 'substituída' deste orçamento também voltam pra 'em revisão'. O orçamento volta pra 'em revisão'."
        confirmLabel="Cancelar aprovação"
        onConfirm={handleCancelar}
        pending={pending}
      />

      {error && (
        <div className="text-xs text-california-red mt-1">{error}</div>
      )}
    </>
  );
}
