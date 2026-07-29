"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { aprovarAberturaJob } from "@/app/(app)/jobs/actions";

interface Props {
  jobId: string;
  jobCodigo: string;
}

export function AprovarDrawer({ jobId, jobCodigo }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function handleAprovar() {
    setError(null);
    startTransition(async () => {
      const res = await aprovarAberturaJob(jobId);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
        title="Aprovar abertura"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        Aprovar
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Aprovar abertura do ${jobCodigo}?`}
        description="O job muda pra 'Aberto' e entra em operação normal."
        confirmLabel="Aprovar"
        onConfirm={handleAprovar}
        pending={pending}
      />
      {error && <p className="text-xs text-california-red mt-1">{error}</p>}
    </>
  );
}
