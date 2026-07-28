"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Archive, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DrawerContent,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Cliente, Profile, Projeto } from "@/lib/types";
import { ProjetoForm } from "./projeto-form";
import { arquivarProjeto, reativarProjeto } from "./actions";

interface Props {
  projeto: Projeto;
  clientes: Pick<Cliente, "id" | "nome_fantasia" | "codigo_curto">[];
  responsaveis: Pick<Profile, "id" | "nome">[];
}

export function ProjetoEditorDrawer({ projeto, clientes, responsaveis }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirmArquivar, setConfirmArquivar] = React.useState(false);
  const [confirmReativar, setConfirmReativar] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function handleArquivar() {
    setError(null);
    startTransition(async () => {
      const res = await arquivarProjeto(projeto.id);
      if (!res.ok) setError(res.message);
      else {
        setConfirmArquivar(false);
        router.refresh();
        setOpen(false);
      }
    });
  }

  function handleReativar() {
    setError(null);
    startTransition(async () => {
      const res = await reativarProjeto(projeto.id);
      if (!res.ok) setError(res.message);
      else {
        setConfirmReativar(false);
        router.refresh();
        setOpen(false);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" />
        Editar projeto
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>Editar projeto {projeto.codigo}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            <ProjetoForm
              projeto={projeto}
              clientes={clientes}
              responsaveis={responsaveis}
              onSuccess={() => setOpen(false)}
              onCancel={() => setOpen(false)}
            />

            {error && (
              <p className="mt-4 text-sm text-california-red">{error}</p>
            )}
          </div>

          <div className="border-t border-border px-6 py-4 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Status: <strong className="text-foreground">{projeto.status}</strong>
            </p>
            {projeto.status === "ativo" ? (
              <button
                type="button"
                onClick={() => setConfirmArquivar(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Archive className="h-3.5 w-3.5" />
                Arquivar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReativar(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reativar
              </button>
            )}
          </div>
        </DrawerContent>
      </Dialog>

      <ConfirmDialog
        open={confirmArquivar}
        onOpenChange={setConfirmArquivar}
        title="Arquivar projeto?"
        description="O projeto sai da lista principal e passa a aparecer só quando o filtro 'arquivados' estiver ligado. Só é possível arquivar se todos os orçamentos estiverem cancelados."
        confirmLabel="Arquivar"
        onConfirm={handleArquivar}
        pending={pending}
      />

      <ConfirmDialog
        open={confirmReativar}
        onOpenChange={setConfirmReativar}
        title="Reativar projeto?"
        description="O projeto volta pra lista de ativos."
        confirmLabel="Reativar"
        onConfirm={handleReativar}
        pending={pending}
      />
    </>
  );
}
