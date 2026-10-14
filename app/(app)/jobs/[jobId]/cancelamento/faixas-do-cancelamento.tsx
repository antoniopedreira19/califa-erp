"use client";

/**
 * As faixas do pedido de cancelamento na página do job (decisão 169), no
 * lugar em que a página já mostra a devolução da abertura:
 *   * pedido no ar — âmbar, com quem pediu, o motivo e "Retirar pedido";
 *   * recusa — vermelha, com a justificativa do financeiro, até a produção
 *     dispensar o aviso. Sem o nome de quem recusou, como na devolução
 *     (decisão 136): a produção fala com o financeiro, não com a pessoa.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Undo2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDataAsHoraBr } from "@/lib/formatar-data-hora";
import type { CancelamentoDoJob } from "@/lib/types";
import {
  dispensarRecusaDoCancelamento,
  retirarPedidoDeCancelamento,
} from "../actions-cancelamento";

export function FaixaCancelamentoSolicitado({
  pedido,
  podeRetirar,
}: {
  pedido: CancelamentoDoJob;
  /** `jobs.solicitar_cancelamento`: GP e administrador. */
  podeRetirar: boolean;
}) {
  const router = useRouter();
  const [retirando, setRetirando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function retirar() {
    setErro(null);
    startTransition(async () => {
      const res = await retirarPedidoDeCancelamento(pedido.id);
      if (!res.ok) {
        setErro(res.message);
        router.refresh();
        return;
      }
      setRetirando(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-800">
            Cancelamento solicitado · aguardando o financeiro
          </p>
          <p className="mb-2 text-[13px] text-amber-900/70">
            Solicitado por {pedido.solicitadoPorNome} em {formatDataAsHoraBr(pedido.solicitadoEm)}
          </p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{pedido.motivo}</p>
          <p className="mt-3 text-xs text-amber-900/70">
            Enquanto o financeiro não decide, o job fica parado: sem PP nova, errata nem envio para
            faturamento.
          </p>
        </div>
        {podeRetirar && (
          <button
            type="button"
            onClick={() => {
              setErro(null);
              setRetirando(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100"
          >
            <Undo2 className="h-4 w-4" />
            Retirar pedido
          </button>
        )}
      </div>
      <ConfirmDialog
        open={retirando}
        onOpenChange={(o) => !o && !pending && setRetirando(false)}
        title="Retirar o pedido de cancelamento?"
        description={
          <>
            O job volta ao normal e o pedido sai da fila do financeiro. A retirada fica registrada no
            histórico do job.
            {erro && <span className="mt-3 block text-xs text-california-red">{erro}</span>}
          </>
        }
        confirmLabel="Sim, retirar"
        cancelLabel="Voltar"
        pending={pending}
        onConfirm={retirar}
      />
    </div>
  );
}

export function FaixaCancelamentoRecusado({
  pedido,
  podeDispensar,
}: {
  pedido: CancelamentoDoJob;
  /** Administrador, GP ou produtor — a mesma régua da função do banco. */
  podeDispensar: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  function dispensar() {
    setErro(null);
    startTransition(async () => {
      const res = await dispensarRecusaDoCancelamento(pedido.id);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-california-red/30 bg-california-red/5 p-6 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-california-red">
            Cancelamento recusado pelo financeiro
          </p>
          {pedido.decididoEm && (
            <p className="mb-2 text-[13px] text-muted-foreground">
              Recusado pelo Financeiro em {formatDataAsHoraBr(pedido.decididoEm)}
            </p>
          )}
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {pedido.justificativa?.trim() || "— sem justificativa informada"}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            O job segue aberto, com PP, errata e faturamento liberados. Se ainda precisar cancelar, fale
            com o financeiro e peça de novo.
          </p>
          {erro && <p className="mt-2 text-xs text-california-red">{erro}</p>}
        </div>
        {podeDispensar && (
          <button
            type="button"
            onClick={dispensar}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            Dispensar aviso
          </button>
        )}
      </div>
    </div>
  );
}
