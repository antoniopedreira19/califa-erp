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
import { criarNivel, editarNivel } from "./actions";
import type { Nivel } from "@/lib/types";

type Props =
  | { mode: "criar"; nivel?: undefined; trigger?: React.ReactNode }
  | {
      mode: "editar";
      nivel: Nivel;
      trigger?: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    };

export function NivelDrawer(props: Props) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

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
          ? await criarNivel(formData)
          : await editarNivel(props.nivel.id, formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      handleOpenChange(false);
      router.refresh();
    });
  }

  const initialCodigo = props.mode === "editar" ? props.nivel.codigo : "";
  const initialDescricao =
    props.mode === "editar" ? (props.nivel.descricao ?? "") : "";
  const initialOrdem =
    props.mode === "editar" && props.nivel.ordem !== null
      ? String(props.nivel.ordem)
      : "";

  const title = props.mode === "criar" ? "Novo nível" : "Editar nível";
  const submitLabel =
    props.mode === "criar"
      ? pending
        ? "Criando..."
        : "Criar nível"
      : pending
        ? "Salvando..."
        : "Salvar";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {props.trigger && <DialogTrigger asChild>{props.trigger}</DialogTrigger>}
      {props.mode === "criar" && !props.trigger && (
        <DialogTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Novo nível
          </button>
        </DialogTrigger>
      )}
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {props.mode === "criar"
              ? "Nível representa hierarquia de cargo (N3 < N4 < N5). Não é faixa salarial."
              : "Editar código ou descrição afeta os colaboradores classificados neste nível."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="codigo">Código</Label>
              <Input
                id="codigo"
                name="codigo"
                autoFocus
                required
                maxLength={20}
                defaultValue={initialCodigo}
                placeholder="Ex.: N3, N4, N5"
              />
              {fieldErrors.codigo?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="descricao">
                Descrição{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (opcional)
                </span>
              </Label>
              <Input
                id="descricao"
                name="descricao"
                maxLength={200}
                defaultValue={initialDescricao}
                placeholder="Ex.: Nível pleno"
              />
              {fieldErrors.descricao?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ordem">
                Ordem{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (opcional — usada para ordenar níveis na UI)
                </span>
              </Label>
              <Input
                id="ordem"
                name="ordem"
                type="number"
                min={1}
                max={32767}
                defaultValue={initialOrdem}
                placeholder="Ex.: 3, 4, 5"
                className="no-spinner"
              />
              {fieldErrors.ordem?.map((msg, i) => (
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
