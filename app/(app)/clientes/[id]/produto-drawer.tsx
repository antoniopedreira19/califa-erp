"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClienteProduto } from "@/lib/types";
import { criarProduto, editarProduto } from "./produtos-actions";

type Props = { clienteId: string } & (
  | { mode: "criar"; produto?: undefined }
  | {
      mode: "editar";
      produto: ClienteProduto;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }
);

export function ProdutoDrawer(props: Props) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  const isControlled = props.mode === "editar" && props.open !== undefined;
  const open = isControlled ? (props as any).open : internalOpen;
  const setOpen = isControlled ? (props as any).onOpenChange : setInternalOpen;

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
      setFieldErrors({});
    }
    setOpen(next);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const res =
        props.mode === "criar"
          ? await criarProduto(props.clienteId, formData)
          : await editarProduto(props.clienteId, props.produto.id, formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      handleOpenChange(false);
      router.refresh();
    });
  }

  const isEdit = props.mode === "editar";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {props.mode === "criar" && (
        <DialogTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-california-red-hover transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Novo produto
          </button>
        </DialogTrigger>
      )}
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{isEdit ? "Editar produto" : "Novo produto"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Renomear afeta o dropdown de novos jobs; os jobs já abertos guardam o nome que estava valendo."
              : "O produto fica disponível no dropdown de abertura de job deste cliente. O código é gerado automaticamente."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {isEdit && (
              <div className="space-y-2">
                <Label>Código</Label>
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-sm text-muted-foreground">
                  {props.produto.codigo}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                name="nome"
                autoFocus
                required
                maxLength={120}
                defaultValue={isEdit ? props.produto.nome : ""}
                placeholder="Ex.: Ativação de marca, Patrocínio de evento"
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
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red-hover disabled:opacity-50 transition-colors"
            >
              {pending
                ? isEdit ? "Salvando..." : "Criando..."
                : isEdit ? "Salvar" : "Criar produto"}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
