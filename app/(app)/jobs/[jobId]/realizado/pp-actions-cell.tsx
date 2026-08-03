"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FilePlus, Eye, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PedidoCompra } from "@/lib/types";
import { cancelarPedidoCompra, signedUrlPdf } from "./actions-pp";

interface Props {
  itemRealizadoId: string;
  totalRealizado: number;
  pp: PedidoCompra | null;
  /** Placeholder otimista antes do refresh do server chegar. Se pp existe,
   *  ppOtimista é ignorado. Só tem `codigo` — Ver/Cancelar ficam disabled
   *  (não temos pp.id ainda pra chamar as actions). Some quando pp chega. */
  ppOtimista?: { codigo: string } | null;
  editable: boolean;
  onGerar: (itemRealizadoId: string) => void;
}

const BOTAO_CLASSES =
  "rounded-md p-1.5 text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50";

export function PPActionsCell({
  itemRealizadoId,
  totalRealizado,
  pp,
  ppOtimista,
  editable,
  onGerar,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [askCancelar, setAskCancelar] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  function handleVer() {
    if (!pp) return;
    startTransition(async () => {
      const res = await signedUrlPdf(pp.id);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  function handleCancelarConfirm() {
    if (!pp) return;
    startTransition(async () => {
      const res = await cancelarPedidoCompra(pp.id);
      setAskCancelar(false);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      router.refresh();
    });
  }

  // Estado: sem realizado → trilha vazia (mantem altura)
  if (totalRealizado <= 0) {
    return <div className="h-9" />;
  }

  // Estado: com PP → Ver + Cancelar
  if (pp) {
    return (
      <div className="relative flex items-center h-9 gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleVer}
              disabled={pending}
              className={BOTAO_CLASSES}
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Ver PDF · {pp.codigo}</TooltipContent>
        </Tooltip>
        {editable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setAskCancelar(true)}
                disabled={pending}
                className={BOTAO_CLASSES}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Cancelar {pp.codigo}</TooltipContent>
          </Tooltip>
        )}
        <ConfirmDialog
          open={askCancelar}
          onOpenChange={setAskCancelar}
          title="Cancelar Pedido de Compra?"
          description={
            <>
              <strong className="text-foreground">{pp.codigo}</strong> será
              cancelada e o PDF + anexos apagados definitivamente. Você poderá
              gerar uma nova PP depois.
            </>
          }
          confirmLabel="Cancelar PP"
          cancelLabel="Voltar"
          variant="destructive"
          pending={pending}
          onConfirm={handleCancelarConfirm}
        />
        {erro && (
          <div
            className="absolute right-0 top-full mt-1 whitespace-nowrap rounded border border-california-red/40 bg-white px-2 py-1 text-[10px] text-california-red shadow z-10"
            onClick={() => setErro(null)}
          >
            {erro}
          </div>
        )}
      </div>
    );
  }

  // Estado otimista: PP recém-gerada, aguardando refresh do server pra
  // trocar pelos ícones reais. Mostra Ver/Cancelar disabled (não temos
  // pp.id ainda pra chamar signedUrl/cancelar).
  if (ppOtimista) {
    return (
      <div className="flex items-center h-9 gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled
              className={BOTAO_CLASSES}
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Ver PDF · {ppOtimista.codigo} (atualizando...)</TooltipContent>
        </Tooltip>
        {editable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled
                className={BOTAO_CLASSES}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Cancelar {ppOtimista.codigo} (atualizando...)</TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  }

  // Estado: sem PP, editable → Gerar
  if (editable) {
    return (
      <div className="flex items-center h-9">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onGerar(itemRealizadoId)}
              disabled={pending}
              className={cn(BOTAO_CLASSES, "text-california-red")}
            >
              <FilePlus className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Gerar PP</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // Estado: sem PP, read-only → trilha vazia
  return <div className="h-9" />;
}
