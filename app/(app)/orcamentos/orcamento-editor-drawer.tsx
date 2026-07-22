"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DrawerContent,
} from "@/components/ui/dialog";
import { OrcamentoForm } from "./orcamento-form";
import type { Cliente, Orcamento, Profile } from "@/lib/types";

interface Props {
  orcamento: Orcamento;
  clientes: Pick<Cliente, "id" | "nome_fantasia">[];
  responsaveis: Pick<Profile, "id" | "nome">[];
  /** Bloqueia o botão quando o orçamento está em estado protegido
   *  (aprovado / job_criado). */
  disabled?: boolean;
  disabledReason?: string;
}

export function OrcamentoEditorDrawer({
  orcamento,
  clientes,
  responsaveis,
  disabled,
  disabledReason,
}: Props) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </button>
      </DialogTrigger>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Editar dados do orçamento</DialogTitle>
          <DialogDescription>
            Alterações são registradas em auditoria. Fecha com ESC ou clicando fora.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-6">
          <OrcamentoForm
            orcamento={orcamento}
            clientes={clientes}
            responsaveis={responsaveis}
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </div>
      </DrawerContent>
    </Dialog>
  );
}
