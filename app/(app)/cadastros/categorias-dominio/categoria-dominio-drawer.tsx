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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { criarCategoriaDominio, editarCategoriaDominio } from "./actions";
import type { CategoriaDominio, CategoriaDominioEscopo } from "@/lib/types";

type Props =
  | {
      mode: "criar";
      defaultEscopo?: CategoriaDominioEscopo;
      categoria?: undefined;
      trigger?: React.ReactNode;
    }
  | {
      mode: "editar";
      categoria: CategoriaDominio;
      defaultEscopo?: CategoriaDominioEscopo;
      trigger?: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    };

export function CategoriaDominioDrawer(props: Props) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});
  const [escopo, setEscopo] = React.useState<CategoriaDominioEscopo>(
    props.mode === "editar"
      ? props.categoria.escopo
      : (props.defaultEscopo ?? "projeto"),
  );

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
    formData.set("escopo", escopo);

    startTransition(async () => {
      const res =
        props.mode === "criar"
          ? await criarCategoriaDominio(formData)
          : await editarCategoriaDominio(props.categoria.id, formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      handleOpenChange(false);
      router.refresh();
    });
  }

  const initialNome = props.mode === "editar" ? props.categoria.nome : "";
  const title =
    props.mode === "criar"
      ? "Nova categoria"
      : "Editar categoria";
  const submitLabel =
    props.mode === "criar"
      ? pending
        ? "Criando..."
        : "Criar categoria"
      : pending
        ? "Salvando..."
        : "Salvar";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {props.trigger && (
        <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      )}
      {props.mode === "criar" && !props.trigger && (
        <DialogTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nova categoria
          </button>
        </DialogTrigger>
      )}
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {props.mode === "criar"
              ? "A categoria ficará disponível nos formulários de projeto ou orçamento, conforme o escopo selecionado."
              : "Renomear afeta todos os projetos/orçamentos que já usam esta categoria."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="escopo">Escopo</Label>
              <Select
                value={escopo}
                onValueChange={(v) => setEscopo(v as CategoriaDominioEscopo)}
              >
                <SelectTrigger id="escopo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="projeto">Projeto</SelectItem>
                  <SelectItem value="orcamento">Orçamento</SelectItem>
                </SelectContent>
              </Select>
              {fieldErrors.escopo?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                name="nome"
                autoFocus
                required
                maxLength={120}
                defaultValue={initialNome}
                placeholder="Ex.: Ativação, Always On, Evento"
              />
              {fieldErrors.nome?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
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
