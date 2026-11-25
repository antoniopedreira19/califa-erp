"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Palmtree } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  SolicitarFeriasForm,
  type SolicitarFeriasPayload,
} from "@/app/(app)/_components/solicitar-ferias-form";
import type {
  ColaboradorFeriasPeriodo,
  TipoContratacao,
} from "@/lib/types";
import { solicitarFerias } from "./actions";

type PeriodoComSaldo = ColaboradorFeriasPeriodo & { saldo: number };

type Props = {
  periodos: PeriodoComSaldo[];
  tipoContratacao: TipoContratacao;
};

export function SolicitarFeriasModal({ periodos, tipoContratacao }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  // Sem período com saldo = nada pra solicitar. Abono avulso também exige
  // saldo (agora abate do aquisitivo — ver migration 20261125800001).
  const periodosDisponiveis = periodos.filter((p) => p.saldo > 0);
  const semSaldoNemAbono = periodosDisponiveis.length === 0;

  async function handleSubmit(payload: SolicitarFeriasPayload) {
    return solicitarFerias(payload);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={semSaldoNemAbono}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white shadow-soft transition-colors hover:bg-california-red/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Palmtree className="h-4 w-4" />
          Solicitar férias
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Solicitar férias</DialogTitle>
          <DialogDescription>
            A solicitação precisa ser feita com pelo menos 5 dias de
            antecedência. Depois do envio, o RH recebe sua solicitação para
            aprovar.
          </DialogDescription>
        </DialogHeader>

        <SolicitarFeriasForm
          periodos={periodos}
          tipoContratacao={tipoContratacao}
          modo="colaborador"
          onSubmit={handleSubmit}
          onSucesso={() => {
            setOpen(false);
            router.refresh();
          }}
          onCancelar={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
