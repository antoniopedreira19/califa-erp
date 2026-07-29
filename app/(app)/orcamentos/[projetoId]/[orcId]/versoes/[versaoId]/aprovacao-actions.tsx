"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Undo2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  aprovarVersao,
  cancelarAprovacaoVersao,
} from "../actions";

interface Props {
  versaoId: string;
  status: string;
  temJobAtivo: boolean;
}

export function AprovacaoActions({ versaoId, status, temJobAtivo }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmando, setConfirmando] = React.useState<"aprovar" | "cancelar" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const podeAprovar = ["rascunho", "em_revisao", "enviada_cliente"].includes(status);
  const podeCancelarAprovacao = status === "aprovada" && !temJobAtivo;

  function handleAprovar() {
    setError(null);
    startTransition(async () => {
      const res = await aprovarVersao(versaoId);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setConfirmando(null);
      router.refresh();
    });
  }

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

  if (!podeAprovar && !podeCancelarAprovacao) return null;

  return (
    <>
      {podeAprovar && (
        <button
          type="button"
          onClick={() => setConfirmando("aprovar")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Aprovar versão
        </button>
      )}
      {podeCancelarAprovacao && (
        <button
          type="button"
          onClick={() => setConfirmando("cancelar")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/40 bg-white px-3 py-1.5 text-xs font-semibold text-california-red hover:bg-california-red/5 transition-colors"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Cancelar aprovação
        </button>
      )}

      <ConfirmDialog
        open={confirmando === "aprovar"}
        onOpenChange={(o) => !o && setConfirmando(null)}
        title="Aprovar esta versão?"
        description="Ao aprovar, as outras versões deste orçamento viram 'substituída' automaticamente. O orçamento entra em status 'aprovado' e o botão 'Criar job' fica disponível."
        confirmLabel="Aprovar"
        onConfirm={handleAprovar}
        pending={pending}
      />

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
