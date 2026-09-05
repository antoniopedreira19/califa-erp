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
import { criarSubtipo, atualizarSubtipo } from "./actions";
import type { PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";

type Props =
  | {
      mode: "criar";
      tipos: PlanoContaTipo[];
      tipoIdInicial?: string;
      /** Mapa: tipo_id → próximo código sugerido (ex.: "003") */
      proximosCodigos: Record<string, string>;
      trigger?: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }
  | {
      mode: "editar";
      subtipo: PlanoContaSubtipo;
      tipos: PlanoContaTipo[];
      codigoBloqueado: boolean;
      trigger?: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    };

function apenasDigitos(v: string, max: number) {
  return v.replace(/[^0-9]/g, "").slice(0, max);
}

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
  const codigoBloqueado = isEditar ? props.codigoBloqueado : false;

  const [tipoId, setTipoId] = React.useState<string>(
    isEditar
      ? props.subtipo.tipo_id
      : (props.tipoIdInicial ?? ""),
  );
  const [codigo, setCodigo] = React.useState<string>(
    isEditar
      ? props.subtipo.codigo
      : props.tipoIdInicial
        ? (props.proximosCodigos[props.tipoIdInicial] ?? "")
        : "",
  );

  const isControlled = (props as any).open !== undefined;
  const open = isControlled ? (props as any).open : internalOpen;
  const setOpen = isControlled ? (props as any).onOpenChange : setInternalOpen;

  // Sincronizar valores ao abrir
  React.useEffect(() => {
    if (!open) return;
    if (isEditar && subtipo) {
      setTipoId(subtipo.tipo_id);
      setCodigo(subtipo.codigo);
    } else if (!isEditar) {
      const tid = props.mode === "criar" ? (props.tipoIdInicial ?? "") : "";
      setTipoId(tid);
      const sug =
        props.mode === "criar" && tid
          ? (props.proximosCodigos[tid] ?? "")
          : "";
      setCodigo(sug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Quando muda o tipo em modo criar, sugere próximo código do novo tipo
  function handleTipoChange(next: string) {
    setTipoId(next);
    if (props.mode === "criar" && next) {
      setCodigo(props.proximosCodigos[next] ?? "");
    }
  }

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
    formData.set("tipo_id", tipoId);
    formData.set("codigo", codigo);

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
  const tipoAtualCodigo = props.tipos.find((t) => t.id === tipoId)?.codigo;
  const sugeridoAtual =
    props.mode === "criar" && tipoId
      ? props.proximosCodigos[tipoId]
      : undefined;

  const title = props.mode === "criar" ? "Novo subtipo" : "Editar subtipo";
  const submitLabel = pending ? "Salvando..." : "Salvar";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {props.trigger && <DialogTrigger asChild>{props.trigger}</DialogTrigger>}
      {props.mode === "criar" && !props.trigger && !isControlled && (
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
              ? "Subtipos refinam a classificação dentro de um tipo. Código: 3 dígitos (ex.: 001)."
              : "Edite os dados do subtipo. O código só pode ser alterado se não houver lançamento."}
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
              <Select
                value={tipoId}
                onValueChange={handleTipoChange}
                required
                disabled={codigoBloqueado}
              >
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

            {/* Código */}
            <div className="space-y-2">
              <Label htmlFor="codigo">
                Código *
                {codigoBloqueado && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    Travado — já existe lançamento com este subtipo.
                  </span>
                )}
              </Label>
              <div className="flex items-center gap-2">
                {tipoAtualCodigo && (
                  <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-1.5 font-mono text-sm text-muted-foreground">
                    {tipoAtualCodigo}.
                  </span>
                )}
                <Input
                  id="codigo"
                  name="codigo"
                  required
                  inputMode="numeric"
                  maxLength={3}
                  disabled={codigoBloqueado}
                  value={codigo}
                  onChange={(e) =>
                    setCodigo(apenasDigitos(e.currentTarget.value, 3))
                  }
                  placeholder="001"
                  className="font-mono w-28"
                />
              </div>
              {!codigoBloqueado && props.mode === "criar" && sugeridoAtual && (
                <p className="text-xs text-muted-foreground">
                  Sugerido: <span className="font-mono">{sugeridoAtual}</span>. Você pode alterar.
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
