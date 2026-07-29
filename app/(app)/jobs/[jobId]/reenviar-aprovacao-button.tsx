"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { reenviarJobParaAprovacao } from "@/app/(app)/jobs/actions";

interface Props {
  jobId: string;
}

export function ReenviarAprovacaoButton({ jobId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmando, setConfirmando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handleReenviar() {
    setError(null);
    startTransition(async () => {
      const res = await reenviarJobParaAprovacao(jobId);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setConfirmando(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
      >
        <Send className="h-4 w-4" />
        Reenviar pra aprovação
      </button>
      {error && <p className="mt-2 text-xs text-california-red">{error}</p>}
      <ConfirmDialog
        open={confirmando}
        onOpenChange={(o) => !o && setConfirmando(false)}
        title="Reenviar pra aprovação financeira?"
        description="Ajustes já foram feitos? O job volta pra 'Aguardando abertura' e o motivo anterior será apagado."
        confirmLabel="Reenviar"
        onConfirm={handleReenviar}
        pending={pending}
      />
    </>
  );
}
