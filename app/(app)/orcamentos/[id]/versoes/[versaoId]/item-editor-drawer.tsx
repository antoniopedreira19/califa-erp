"use client";

import * as React from "react";
import { AlertCircle, Plus, Save } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
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
import {
  tipoCustoLabel,
  type TipoCusto,
  type VersaoOrcamentoItem,
} from "@/lib/types";
import {
  adicionarItem,
  atualizarItem,
  type ActionResult,
} from "../actions";

interface Props {
  /** Grupo dono do item (novo). Ignorado em modo edição. */
  grupoId?: string;
  /** Nome do grupo — usado só no header do drawer pra contexto. */
  grupoNome?: string;
  /** Se passado, drawer entra em modo edição desse item. */
  item?: VersaoOrcamentoItem | null;
  /** Modo controlado externo: pai passa open + onOpenChange. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Se false, esconde o trigger (usado quando o pai controla via botão externo). */
  showTrigger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

const TIPOS: TipoCusto[] = ["A", "B", "C", "D"];

export function ItemEditorDrawer({
  grupoId,
  grupoNome,
  item,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  showTrigger = true,
  disabled,
  disabledReason,
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setUncontrolledOpen;

  const isEdit = Boolean(item);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>(
    {},
  );

  const [tipoCusto, setTipoCusto] = React.useState<TipoCusto>(
    item?.tipo_custo ?? "A",
  );

  React.useEffect(() => {
    setTipoCusto(item?.tipo_custo ?? "A");
    setError(null);
    setFieldErrors({});
  }, [item]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    formData.set("tipo_custo", tipoCusto);

    startTransition(async () => {
      const res: ActionResult = isEdit
        ? await atualizarItem(item!.id, formData)
        : grupoId
          ? await adicionarItem(grupoId, formData)
          : { ok: false, message: "Grupo não informado." };

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger && (
        <DialogTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-1.5 text-xs font-semibold text-california-red hover:bg-california-red hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-3.5 w-3.5" />
            Novo item
          </button>
        </DialogTrigger>
      )}
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{isEdit ? "Editar item" : "Novo item"}</DialogTitle>
          <DialogDescription>
            {grupoNome ? (
              <>
                Grupo: <strong className="text-foreground">{grupoNome}</strong>
                {" · "}Total é calculado (valor × qtd × dias/meses).
              </>
            ) : (
              "Total é calculado automaticamente: valor × quantidade × dias/meses."
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <Field label="Descrição do item" name="item" required errors={fieldErrors}>
              <Input
                name="item"
                defaultValue={item?.item ?? ""}
                required
                autoFocus
                placeholder="Ex.: Gerente de Projeto, Locação Vending Machine..."
              />
            </Field>

            <Field label="Tipo de custo" name="tipo_custo" required errors={fieldErrors}>
              <Select value={tipoCusto} onValueChange={(v) => setTipoCusto(v as TipoCusto)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {tipoCustoLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid gap-4 md:grid-cols-3">
              <Field
                label="Valor unitário"
                name="valor_unitario_orcado"
                required
                errors={fieldErrors}
              >
                <Input
                  name="valor_unitario_orcado"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={item?.valor_unitario_orcado ?? ""}
                  required
                  className="no-spinner"
                />
              </Field>
              <Field
                label="Quantidade"
                name="quantidade_orcada"
                required
                errors={fieldErrors}
              >
                <Input
                  name="quantidade_orcada"
                  type="number"
                  step="0.001"
                  min="0.001"
                  defaultValue={item?.quantidade_orcada ?? "1"}
                  required
                />
              </Field>
              <Field
                label="Dias / meses"
                name="dias_meses_orcado"
                required
                errors={fieldErrors}
              >
                <Input
                  name="dias_meses_orcado"
                  type="number"
                  step="0.001"
                  min="0.001"
                  defaultValue={item?.dias_meses_orcado ?? "1"}
                  required
                />
              </Field>
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
              onClick={() => setOpen(false)}
              className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {pending ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {isEdit ? "Salvar" : "Adicionar item"}
                </>
              )}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}

function Field({
  label,
  name,
  required,
  errors,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  errors: Record<string, string[]>;
  children: React.ReactNode;
}) {
  const fieldErrors = errors[name];
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-california-red ml-1">*</span>}
      </Label>
      {children}
      {fieldErrors?.map((msg, i) => (
        <p key={i} className="text-xs text-california-red">
          {msg}
        </p>
      ))}
    </div>
  );
}
