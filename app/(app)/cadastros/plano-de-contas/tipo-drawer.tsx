"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Lock, Plus } from "lucide-react";
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
import { criarTipo, atualizarTipo } from "./actions";
import type { PlanoContaTipo } from "@/lib/types";

type Props =
  | { mode: "criar"; trigger?: React.ReactNode }
  | {
      mode: "editar";
      tipo: PlanoContaTipo;
      codigoBloqueado: boolean;
      trigger?: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    };

export function TipoDrawer(props: Props) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  const isEditar = props.mode === "editar";
  const tipo = isEditar ? props.tipo : undefined;
  const codigoBloqueado = isEditar ? props.codigoBloqueado : false;

  // Estado controlado para o Select de natureza_padrao
  const [natureza, setNatureza] = React.useState<string>(
    tipo?.natureza_padrao ?? "",
  );

  const isControlled = isEditar && (props as any).open !== undefined;
  const open = isControlled ? (props as any).open : internalOpen;
  const setOpen = isControlled ? (props as any).onOpenChange : setInternalOpen;

  // Sincronizar natureza ao abrir
  React.useEffect(() => {
    if (open && isEditar && tipo) {
      setNatureza(tipo.natureza_padrao);
    }
    if (open && !isEditar) {
      setNatureza("");
    }
  }, [open, isEditar, tipo]);

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
    formData.set("natureza_padrao", natureza);

    startTransition(async () => {
      const res =
        props.mode === "criar"
          ? await criarTipo(formData)
          : await atualizarTipo(props.tipo.id, formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      handleOpenChange(false);
      router.refresh();
    });
  }

  const title = props.mode === "criar" ? "Novo tipo" : "Editar tipo";
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
            Novo tipo
          </button>
        </DialogTrigger>
      )}
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {props.mode === "criar"
              ? "Tipos definem a natureza do lançamento no DRE."
              : "Edite o tipo. O código só pode ser alterado se não houver lançamentos."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Código */}
            <div className="space-y-2">
              <Label htmlFor="codigo">
                Código *
                {codigoBloqueado && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    Travado — já existe lançamento com este tipo.
                  </span>
                )}
              </Label>
              <Input
                id="codigo"
                name="codigo"
                autoFocus={!codigoBloqueado}
                required
                maxLength={6}
                disabled={codigoBloqueado}
                defaultValue={tipo?.codigo ?? ""}
                placeholder="Ex.: REC, DP, CO"
                className="uppercase font-mono"
                onChange={(e) => {
                  e.currentTarget.value = e.currentTarget.value.toUpperCase();
                }}
              />
              {fieldErrors.codigo?.map((msg, i) => (
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
                autoFocus={codigoBloqueado}
                required
                maxLength={120}
                defaultValue={tipo?.nome ?? ""}
                placeholder="Ex.: Receitas, Despesas com Pessoal"
              />
              {fieldErrors.nome?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Natureza padrão */}
            <div className="space-y-2">
              <Label htmlFor="natureza_padrao">Natureza padrão *</Label>
              <Select value={natureza} onValueChange={setNatureza} required>
                <SelectTrigger id="natureza_padrao">
                  <SelectValue placeholder="Selecione a natureza" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada</SelectItem>
                  <SelectItem value="saida">Saída</SelectItem>
                  <SelectItem value="ambos">Ambos</SelectItem>
                </SelectContent>
              </Select>
              {fieldErrors.natureza_padrao?.map((msg, i) => (
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
                defaultValue={tipo?.ordem ?? 0}
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
