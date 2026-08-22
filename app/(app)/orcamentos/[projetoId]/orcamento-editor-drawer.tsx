"use client";

import * as React from "react";
import { Pencil, Lock } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DrawerContent,
} from "@/components/ui/dialog";
import type {
  CategoriaDominio,
  Orcamento,
  Profile,
  Regional,
} from "@/lib/types";
import type { CidadeOption } from "../cidade-combobox";
import { OrcamentoForm } from "./orcamento-form";

interface Props {
  projetoId: string;
  orcamento: Orcamento;
  categorias: Pick<CategoriaDominio, "id" | "nome">[];
  regionaisDoProjeto: Pick<Regional, "id" | "nome">[];
  cidadesIniciais: CidadeOption[];
  cidadeAtual: CidadeOption | null;
  gpsDoProjeto: Pick<Profile, "id" | "nome">[];
  produtores: Pick<Profile, "id" | "nome">[];
  disabled?: boolean;
  disabledReason?: string;
}

export function OrcamentoEditorDrawer({
  projetoId,
  orcamento,
  categorias,
  regionaisDoProjeto,
  cidadesIniciais,
  cidadeAtual,
  gpsDoProjeto,
  produtores,
  disabled,
  disabledReason,
}: Props) {
  const [open, setOpen] = React.useState(false);

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        title={disabledReason}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground cursor-not-allowed"
      >
        <Lock className="h-3.5 w-3.5" />
        Editar
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" />
        Editar
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>Editar orçamento {orcamento.codigo}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            <OrcamentoForm
              projetoId={projetoId}
              orcamento={orcamento}
              categorias={categorias}
              regionaisDoProjeto={regionaisDoProjeto}
              cidadesIniciais={cidadesIniciais}
              cidadeAtual={cidadeAtual}
              gpsDoProjeto={gpsDoProjeto}
              produtores={produtores}
              onSuccess={() => setOpen(false)}
              onCancel={() => setOpen(false)}
            />
          </div>
        </DrawerContent>
      </Dialog>
    </>
  );
}
