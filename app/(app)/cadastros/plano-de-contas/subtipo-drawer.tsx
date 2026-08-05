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
import { criarSubtipo, atualizarSubtipo } from "./actions";
import type { PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";

type Props =
  | { mode: "criar"; tipos: PlanoContaTipo[]; trigger?: React.ReactNode }
  | {
      mode: "editar";
      subtipo: PlanoContaSubtipo;
      tipos: PlanoContaTipo[];
      trigger?: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    };

export function SubtipoDrawer(props: Props) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  const isEditar = props.mode === "editar";
  const subtipo = isEditar ? props.subtipo : undefined;

  // Estado controlado para o Select de tipo
  const [tipoId, setTipoId] = React.useState<string>(
    subtipo?.tipo_id ?? "",
  );

  const isControlled = isEditar && (props as any).open !== undefined;
  const open = isControlled ? (props as any).open : internalOpen;
  const setOpen = isControlled ? (props as any).onOpenChange : setInternalOpen;

  // Sincronizar tipoId ao abrir
  React.useEffect(() => {
    if (open && isEditar && subtipo) {
      setTipoId(subtipo.tipo_id);
    }
    if (open && !isEditar) {
      setTipoId("");
    }
  }, [open, isEditar, subtipo]);

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
    // Injetar valor do select controlado
    formData.set("tipo_id", tipoId);

    startTransition(async () => {
      const res =
        props.mode === "criar"
          ? await criarSubtipo(formData)
          : await atualizarSubtipo(props.subtipo.id, formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      handleOpenChange(false);
      router.refresh();
    });
  }

  const tiposAtivos = props.tipos.filter((t) => t.ativo);

  const title = props.mode === "criar" ? "Novo subtipo" : "Editar subtipo";
  const submitLabel =
    props.mode === "criar"
      ? pending
        ? "Criando..."
        : "Salvar"
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
            Novo subtipo
          </button>
        </DialogTrigger>
      )}
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {props.mode === "criar"
              ? "Subtipos refinam a classificação dentro de um tipo de lançamento."
              : "Edite os dados do subtipo."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Tipo */}
            <div className="space-y-2">
              <Label htmlFor="tipo_id">Tipo *</Label>
              <Select value={tipoId} onValueChange={setTipoId} required>
                <SelectTrigger id="tipo_id">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  {tiposAtivos.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.codigo} · {t.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.tipo_id?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Nome */}
            <div className="space-y-2">
              <Label htmlFor="nome">Nome *</Label>
              <Input
                id="nome"
                name="nome"
                autoFocus
                required
                maxLength={160}
                defaultValue={subtipo?.nome ?? ""}
                placeholder="Ex.: Salário, Aluguel, Produção"
              />
              {fieldErrors.nome?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Ordem */}
            <div className="space-y-2">
              <Label htmlFor="ordem">Ordem</Label>
              <Input
                id="ordem"
                name="ordem"
                type="number"
                min={0}
                step={1}
                defaultValue={subtipo?.ordem ?? 0}
                placeholder="0"
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
