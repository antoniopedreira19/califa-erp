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
  | {
      mode: "criar";
      proximoCodigo: string;
      trigger?: React.ReactNode;
    }
  | {
      mode: "editar";
      tipo: PlanoContaTipo;
      codigoBloqueado: boolean;
      trigger?: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    };

function apenasDigitos(v: string, max: number) {
  return v.replace(/[^0-9]/g, "").slice(0, max);
}

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
  const codigoInicial = isEditar
    ? (tipo?.codigo ?? "")
    : props.proximoCodigo;

  const [codigo, setCodigo] = React.useState<string>(codigoInicial);
  const [natureza, setNatureza] = React.useState<string>(
    tipo?.natureza_padrao ?? "",
  );

  const isControlled = isEditar && (props as any).open !== undefined;
  const open = isControlled ? (props as any).open : internalOpen;
  const setOpen = isControlled ? (props as any).onOpenChange : setInternalOpen;

  // Sincronizar valores ao abrir
  React.useEffect(() => {
    if (open) {
      if (isEditar && tipo) {
        setCodigo(tipo.codigo);
        setNatureza(tipo.natureza_padrao);
      } else if (!isEditar) {
        setCodigo(props.mode === "criar" ? props.proximoCodigo : "");
        setNatureza("");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    formData.set("natureza_padrao", natureza);
    formData.set("codigo", codigo);

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
  const submitLabel = pending
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
              ? "Tipos são o nível macro do plano de contas. Código: 2 dígitos (ex.: 01, 15)."
              : "Edite o tipo. O código só pode ser alterado se não houver lançamento."}
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
                inputMode="numeric"
                maxLength={2}
                disabled={codigoBloqueado}
                value={codigo}
                onChange={(e) => setCodigo(apenasDigitos(e.currentTarget.value, 2))}
                placeholder="01"
                className="font-mono w-24"
              />
              {!codigoBloqueado && props.mode === "criar" && (
                <p className="text-xs text-muted-foreground">
                  Sugerido: <span className="font-mono">{props.proximoCodigo}</span>. Você pode alterar.
                </p>
              )}
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
                placeholder="Ex.: Receita, Despesa com Pessoal"
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
