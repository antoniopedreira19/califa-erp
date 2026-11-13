"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import type {
  ColaboradorFeriasPeriodo,
  TipoContratacao,
} from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LancarDiretoForm } from "../lancar-direto-form";

type PeriodoComSaldo = ColaboradorFeriasPeriodo & { saldo: number };

type Props = {
  colaboradorId: string;
  tipoContratacao: TipoContratacao;
  periodos: PeriodoComSaldo[];
};

/**
 * Botão "Lançar férias" na página do colaborador. Abre modal com o
 * form reaproveitado de `lancar-direto-form.tsx`. Ao salvar, dá
 * router.refresh() pra atualizar a página do colaborador.
 */
export function BotaoLancarDiretoCliente({
  colaboradorId,
  tipoContratacao,
  periodos,
}: Props) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-california-red px-3 py-1.5 text-sm font-medium text-white hover:bg-california-red/90 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Lançar férias
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Lançar férias</DialogTitle>
          </DialogHeader>
          <LancarDiretoForm
            colaboradorId={colaboradorId}
            tipoContratacao={tipoContratacao}
            periodosComSaldo={periodos}
            onFechar={() => setAberto(false)}
            onSucesso={() => {
              setAberto(false);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
