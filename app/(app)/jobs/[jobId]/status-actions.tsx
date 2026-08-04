"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PlayCircle, Send, XCircle } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { atualizarStatusJob } from "@/app/(app)/jobs/actions";
import type { JobStatus } from "@/lib/types";
import { jobStatusLabel, ENCERRAMENTO_INDISPONIVEL } from "@/lib/types";

interface Props {
  jobId: string;
  transicoes: JobStatus[];
  /** Mostra o botão de encerramento (desabilitado) junto das transições. */
  mostrarEncerramento?: boolean;
}

const STATUS_META: Record<string, { icon: React.ElementType; classes: string; verb: string }> = {
  aberto: { icon: PlayCircle, classes: "bg-blue-600 text-white hover:bg-blue-700", verb: "reabrir" },
  em_producao: { icon: PlayCircle, classes: "bg-amber-600 text-white hover:bg-amber-700", verb: "iniciar produção" },
  cancelado: { icon: XCircle, classes: "bg-california-red text-white hover:bg-california-red-hover", verb: "cancelar" },
};

export function StatusActions({
  jobId,
  transicoes,
  mostrarEncerramento,
}: Props) {
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
        {/* Primário no design, mas sem fluxo por trás ainda: fica
            desabilitado e explica o porquê, em vez de encerrar o job sem
            nenhum processo. */}
        {mostrarEncerramento && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <button
                  type="button"
                  disabled
                  className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white opacity-50"
                >
                  <Send className="h-4 w-4" />
                  Enviar job para encerramento
                </button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{ENCERRAMENTO_INDISPONIVEL}</TooltipContent>
          </Tooltip>
        )}
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
              {/* Rótulo é a ação ("Cancelar job"), não o status de destino
                  ("Cancelado") — é assim no design e lê melhor num botão. */}
              {meta.verb.charAt(0).toUpperCase() + meta.verb.slice(1)} job
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
