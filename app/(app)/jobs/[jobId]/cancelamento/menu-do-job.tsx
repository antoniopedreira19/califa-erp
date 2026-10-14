"use client";

/**
 * O menu "⋯" do cabeçalho do job, ao lado do Editar (decisão 169, opção A
 * do protótipo de 13/10/2026): a porta do pedido de cancelamento. Discreto
 * numa tela que se usa o dia inteiro, e à mão de qualquer aba.
 */

import * as React from "react";
import { Ban, MoreHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SolicitarCancelamentoDialog, type PPDoPedido } from "./solicitar-cancelamento-dialog";

export function MenuDoJob({
  jobId,
  jobCodigo,
  pps,
  travaForaDasPPs,
}: {
  jobId: string;
  jobCodigo: string;
  pps: PPDoPedido[];
  travaForaDasPPs: string | null;
}) {
  const [menu, setMenu] = React.useState(false);
  const [pedido, setPedido] = React.useState(false);

  return (
    <>
      <Popover open={menu} onOpenChange={setMenu}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Mais ações do job"
            className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border bg-white text-foreground transition-colors hover:bg-accent"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[248px] p-1">
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              setPedido(true);
            }}
            className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-california-red/5"
          >
            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-california-red" />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-california-red">
                Solicitar cancelamento
              </span>
              <span className="block text-[11.5px] text-muted-foreground">
                O financeiro aprova ou recusa
              </span>
            </span>
          </button>
        </PopoverContent>
      </Popover>
      <SolicitarCancelamentoDialog
        open={pedido}
        onOpenChange={setPedido}
        jobId={jobId}
        jobCodigo={jobCodigo}
        pps={pps}
        travaForaDasPPs={travaForaDasPPs}
      />
    </>
  );
}
