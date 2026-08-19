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
import { EncerrarDialog, type ResumoEncerramento } from "./encerrar-dialog";

interface Props {
  jobId: string;
  transicoes: JobStatus[];
  /** Mostra o botão de encerramento junto das transições. */
  mostrarEncerramento?: boolean;
  /**
   * Números do fechamento. Sem eles o botão aparece desabilitado com a
   * explicação — é o caso de quem chega ao job por fora do financeiro.
   */
  resumoEncerramento?: ResumoEncerramento | null;
}

const STATUS_META: Record<string, { icon: React.ElementType; classes: string; verb: string }> = {
  aberto: { icon: PlayCircle, classes: "bg-blue-600 text-white hover:bg-blue-700", verb: "reabrir" },
  em_producao: { icon: PlayCircle, classes: "bg-amber-600 text-white hover:bg-amber-700", verb: "iniciar produção" },
  // Secundário na barra: borda e fundo branco, ficando vermelho no hover.
  cancelado: { icon: XCircle, classes: "border border-border bg-white text-foreground hover:border-california-red/40 hover:text-california-red", verb: "cancelar" },
};

export function StatusActions({
  jobId,
  transicoes,
  mostrarEncerramento,
  resumoEncerramento,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmando, setConfirmando] = React.useState<JobStatus | null>(null);
  const [encerrando, setEncerrando] = React.useState(false);
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
    // Linha, não coluna: desde 19/08/2026 estes botões moram na barra fixa
    // do rodapé, que é horizontal. O erro entra à esquerda dos botões em
    // vez de embaixo — embaixo esticaria a barra e empurraria o conteúdo.
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        {error && (
          <span className="text-xs font-medium text-california-red">
            {error}
          </span>
        )}
        {/* Só existe depois do envio para faturamento. Abre o resumo de
            fechamento: encerrar é o fim da linha do job, não um clique
            direto. */}
        {mostrarEncerramento &&
          (resumoEncerramento ? (
            <button
              type="button"
              onClick={() => setEncerrando(true)}
              className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-[10px] bg-california-red px-4 text-[13px] font-semibold text-white transition-colors hover:bg-california-red-hover"
            >
              <Send className="h-4 w-4" />
              Enviar job para encerramento
            </button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-9 cursor-not-allowed items-center gap-2 whitespace-nowrap rounded-[10px] bg-california-red px-4 text-[13px] font-semibold text-white opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    Enviar job para encerramento
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{ENCERRAMENTO_INDISPONIVEL}</TooltipContent>
            </Tooltip>
          ))}
        {transicoes.map((s) => {
          const meta = STATUS_META[s];
          if (!meta) return null;
          const Icon = meta.icon;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setConfirmando(s)}
              className={`inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-[10px] px-4 text-[13px] font-semibold transition-colors ${meta.classes}`}
            >
              <Icon className="h-4 w-4" />
              {/* Rótulo é a ação ("Cancelar job"), não o status de destino
                  ("Cancelado") — é assim no design e lê melhor num botão. */}
              {meta.verb.charAt(0).toUpperCase() + meta.verb.slice(1)} job
            </button>
          );
        })}
      </div>

      {resumoEncerramento && (
        <EncerrarDialog
          jobId={jobId}
          resumo={resumoEncerramento}
          open={encerrando}
          onOpenChange={setEncerrando}
        />
      )}

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
    </>
  );
}
