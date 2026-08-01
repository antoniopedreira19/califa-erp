"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FilePlus, Eye, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import type { PedidoCompra } from "@/lib/types";
import { cancelarPedidoCompra, signedUrlPdf } from "./actions-pp";

interface Props {
  itemRealizadoId: string;
  totalRealizado: number;
  pp: PedidoCompra | null;
  editable: boolean;
  onGerar: (itemRealizadoId: string) => void;
}

const BOTAO_CLASSES =
  "rounded-md p-1.5 text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50";

export function PPActionsCell({
  itemRealizadoId,
  totalRealizado,
  pp,
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
        <button
          type="button"
          onClick={handleVer}
          disabled={pending}
          title={`Ver PDF · ${pp.codigo}`}
          className={BOTAO_CLASSES}
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
        {editable && (
          <button
            type="button"
            onClick={() => setAskCancelar(true)}
            disabled={pending}
            title={`Cancelar ${pp.codigo}`}
            className={BOTAO_CLASSES}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <ConfirmDialog
          open={askCancelar}
          onOpenChange={setAskCancelar}
          title="Cancelar Pedido de Compra?"
          description={
            <>
              <strong className="text-foreground">{pp.codigo}</strong> sera
              cancelada e o PDF + anexos apagados definitivamente. Voce podera
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

  // Estado: sem PP, editable → Gerar
  if (editable) {
    return (
      <div className="flex items-center h-9">
        <button
          type="button"
          onClick={() => onGerar(itemRealizadoId)}
          disabled={pending}
          title="Gerar PP"
          className={cn(BOTAO_CLASSES, "text-california-red")}
        >
          <FilePlus className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Estado: sem PP, read-only → trilha vazia
  return <div className="h-9" />;
}
