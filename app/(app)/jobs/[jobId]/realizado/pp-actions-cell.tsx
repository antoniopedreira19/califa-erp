"use client";

import * as React from "react";
import { FilePlus, Eye } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PedidoCompra } from "@/lib/types";
import { signedUrlPdf } from "./actions-pp";

interface Props {
  itemRealizadoId: string;
  totalRealizado: number;
  pp: PedidoCompra | null;
  /** Placeholder otimista antes do refresh do server chegar. Só tem
   *  `codigo` — o botão fica disabled porque ainda não temos pp.id pra
   *  chamar a action. Some quando a PP real chega via prop. */
  ppOtimista?: { codigo: string } | null;
  editable: boolean;
  onGerar: (itemRealizadoId: string) => void;
}

/** Altura da linha da planilha — a trilha precisa acompanhar pra alinhar. */
const ALTURA = "h-[34px]";

const PILULA =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50";

export function PPActionsCell({
  itemRealizadoId,
  totalRealizado,
  pp,
  ppOtimista,
  editable,
  onGerar,
}: Props) {
  const [pending, startTransition] = React.useTransition();
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

  // Sem realizado lançado não há o que pedir: trilha vazia, mantendo altura.
  if (totalRealizado <= 0) {
    return <div className={ALTURA} />;
  }

  // Com PP: só visualizar. Cancelar mora na aba de Pedidos de Produção.
  if (pp) {
    return (
      <div className={cn("relative flex items-center", ALTURA)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleVer}
              disabled={pending}
              className={cn(
                PILULA,
                "border-border bg-white text-foreground hover:border-[#d7d7d7] hover:bg-muted",
              )}
            >
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
              Ver PP
            </button>
          </TooltipTrigger>
          <TooltipContent>Ver PDF · {pp.codigo}</TooltipContent>
        </Tooltip>
        {erro && (
          <div
            className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded border border-california-red/40 bg-white px-2 py-1 text-[10px] text-california-red shadow"
            onClick={() => setErro(null)}
          >
            {erro}
          </div>
        )}
      </div>
    );
  }

  // PP recém-gerada, aguardando o refresh do server trazer o id real.
  if (ppOtimista) {
    return (
      <div className={cn("flex items-center", ALTURA)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled
              className={cn(
                PILULA,
                "border-border bg-white text-foreground",
              )}
            >
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
              Ver PP
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Ver PDF · {ppOtimista.codigo} (atualizando...)
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  if (editable) {
    return (
      <div className={cn("flex items-center", ALTURA)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onGerar(itemRealizadoId)}
              disabled={pending}
              className={cn(
                PILULA,
                "border-border bg-white text-california-red hover:border-california-red/30 hover:bg-california-red/[0.06]",
              )}
            >
              <FilePlus className="h-3.5 w-3.5" />
              Gerar PP
            </button>
          </TooltipTrigger>
          <TooltipContent>Gerar PP</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return <div className={ALTURA} />;
}
