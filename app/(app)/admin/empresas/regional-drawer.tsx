"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarRegional, editarRegional } from "./actions";
import type { Regional } from "@/lib/types";

type Props = {
  /** Empresa dona da regional. Vem do contexto do card — não é escolhida no form. */
  empresaId: string;
  empresaNome: string;
  /** Regional existente para editar; ausente = criar. */
  regional?: Regional;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Drawer de criar/editar regional dentro do organograma de /admin/empresas.
 * A empresa vem do card em que o botão foi clicado — sem combobox de
 * empresa aqui, o contexto é o próprio card.
 */
export function RegionalDrawer({
  empresaId,
  empresaNome,
  regional,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const isEdit = Boolean(regional);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
      setFieldErrors({});
    }
    onOpenChange(next);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);
    formData.set("empresa_id", empresaId);

    startTransition(async () => {
      const res = isEdit
        ? await editarRegional(regional!.id, formData)
        : await criarRegional(formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      handleOpenChange(false);
      router.refresh();
    });
  }

  const title = isEdit ? "Editar regional" : "Nova regional";
  const submitLabel = isEdit
    ? pending ? "Salvando..." : "Salvar"
    : pending ? "Criando..." : "Criar regional";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? `Renomear afeta todos os jobs já associados a esta regional. Empresa: ${empresaNome}.`
              : `Nova regional da empresa ${empresaNome}.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                name="nome"
                autoFocus
                required
                maxLength={80}
                defaultValue={regional?.nome ?? ""}
                placeholder="Ex.: SP, Nordeste, Rio de Janeiro"
              />
              {fieldErrors.nome?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">{msg}</p>
              ))}
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
