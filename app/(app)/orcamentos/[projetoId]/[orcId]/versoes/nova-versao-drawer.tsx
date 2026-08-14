"use client";

import * as React from "react";
import { AlertCircle, Lock, Plus, Save } from "lucide-react";
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
  ALIQUOTAS_IMPOSTO,
  aliquotaParaValor,
  formatarAliquota,
} from "@/lib/impostos";
import { criarVersao, type ActionResult } from "./actions";

interface Props {
  orcamentoId: string;
  /** Honorários do cadastro do cliente. Só exibição: o campo é travado e a
   *  server action relê o percentual do cadastro na hora de gravar. */
  honorariosCliente: number;
  clienteNome: string | null;
  /** Bloqueia o botão em orçamentos que não aceitam mais versão. */
  disabled?: boolean;
  disabledReason?: string;
}

export function NovaVersaoDrawer({
  orcamentoId,
  honorariosCliente,
  clienteNome,
  disabled,
  disabledReason,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});
  const [imposto, setImposto] = React.useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    // O Select é controlado e não tem `name`: o valor entra aqui. Deixar em
    // branco é permitido — a alíquota só é exigida para aprovar a versão, não
    // para criá-la; sem escolha a action grava o default 0.
    if (imposto !== "") formData.set("percentual_imposto", imposto);

    startTransition(async () => {
      const res: ActionResult = await criarVersao(orcamentoId, formData);
      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
      }
      // Server action redireciona para a versão criada em caso de sucesso.
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-california-red-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="h-3.5 w-3.5" />
          Nova versão
        </button>
      </DialogTrigger>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Nova versão do orçamento</DialogTitle>
          <DialogDescription>
            O número (v1, v2...) é atribuído automaticamente. Os itens são
            adicionados dentro da versão depois.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Moeda" name="moeda" errors={fieldErrors}>
                <Input
                  name="moeda"
                  defaultValue="BRL"
                  maxLength={3}
                  className="uppercase"
                />
              </Field>
              <Field
                label="Taxa de câmbio"
                name="taxa_cambio"
                errors={fieldErrors}
              >
                <Input
                  name="taxa_cambio"
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  className="no-spinner"
                />
              </Field>
              <Field
                label="Honorários (%)"
                name="percentual_honorarios"
                errors={fieldErrors}
                travado
                hint={`Cadastro de ${clienteNome ?? "cliente"}`}
              >
                {/* Sem `name`: nada é enviado, a action lê o cadastro. */}
                <Input
                  type="number"
                  value={honorariosCliente}
                  readOnly
                  disabled
                  className="no-spinner bg-muted/50 text-muted-foreground"
                />
              </Field>
              <Field
                label="Impostos (%)"
                name="percentual_imposto"
                errors={fieldErrors}
              >
                <Select value={imposto} onValueChange={setImposto}>
                  <SelectTrigger id="percentual_imposto">
                    <SelectValue placeholder="Selecione a alíquota" />
                  </SelectTrigger>
                  <SelectContent>
                    {ALIQUOTAS_IMPOSTO.map((a) => (
                      <SelectItem key={a} value={aliquotaParaValor(a)}>
                        {formatarAliquota(a)}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  Criando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Criar versão
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
  errors,
  travado,
  hint,
  children,
}: {
  label: string;
  name: string;
  errors: Record<string, string[]>;
  /** Mostra o cadeado no rótulo — campo que a tela não deixa editar. */
  travado?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  const fieldErrors = errors[name];
  return (
    <div className="space-y-2">
      <Label htmlFor={name} className="flex items-center gap-1.5">
        {label}
        {travado && <Lock className="h-3 w-3 text-muted-foreground" />}
      </Label>
      {children}
      {hint && (
        <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
      )}
      {fieldErrors?.map((msg, i) => (
        <p key={i} className="text-xs text-california-red">
          {msg}
        </p>
      ))}
    </div>
  );
}
