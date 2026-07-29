"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PlayCircle, CheckCircle2, XCircle } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { atualizarStatusJob } from "@/app/(app)/jobs/actions";
import type { JobStatus } from "@/lib/types";
import { jobStatusLabel } from "@/lib/types";

interface Props {
  jobId: string;
  transicoes: JobStatus[];
}

const STATUS_META: Record<string, { icon: React.ElementType; classes: string; verb: string }> = {
  aberto: { icon: PlayCircle, classes: "bg-blue-600 text-white hover:bg-blue-700", verb: "reabrir" },
  em_producao: { icon: PlayCircle, classes: "bg-amber-600 text-white hover:bg-amber-700", verb: "iniciar produção" },
  finalizado: { icon: CheckCircle2, classes: "bg-emerald-600 text-white hover:bg-emerald-700", verb: "finalizar" },
  cancelado: { icon: XCircle, classes: "bg-california-red text-white hover:bg-california-red-hover", verb: "cancelar" },
};

export function StatusActions({ jobId, transicoes }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmando, setConfirmando] = React.useState<JobStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function handleTransicao(status: JobStatus) {
    setError(null);
    startTransition(async () => {
      const res = await atualizarStatusJob(jobId, status);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setConfirmando(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {transicoes.map((s) => {
          const meta = STATUS_META[s];
          if (!meta) return null;
          const Icon = meta.icon;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setConfirmando(s)}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${meta.classes}`}
            >
              <Icon className="h-4 w-4" />
              {jobStatusLabel(s)}
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs text-california-red">{error}</p>}

      {confirmando && (
        <ConfirmDialog
          open={!!confirmando}
          onOpenChange={(o) => !o && setConfirmando(null)}
          title={`${STATUS_META[confirmando]?.verb.charAt(0).toUpperCase() ?? ""}${STATUS_META[confirmando]?.verb.slice(1) ?? ""} este job?`}
          description={`O status muda pra "${jobStatusLabel(confirmando)}". ${confirmando === "cancelado" ? "Cancelar libera criar novo job pro mesmo orçamento." : ""}`}
          confirmLabel={jobStatusLabel(confirmando)}
          onConfirm={() => handleTransicao(confirmando)}
          pending={pending}
        />
      )}
    </div>
  );
}
