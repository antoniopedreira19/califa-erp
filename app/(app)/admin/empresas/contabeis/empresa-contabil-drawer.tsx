"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Plus, Save } from "lucide-react";
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
import { apenasDigitos, formatarCNPJ } from "@/lib/utils/formato-fiscal";
import {
  criarEmpresaContabil,
  editarEmpresaContabil,
} from "./actions";
import type { EmpresaContabilRow } from "./types";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

type Props =
  | { mode: "criar"; trigger?: React.ReactNode }
  | {
      mode: "editar";
      empresa: EmpresaContabilRow;
      trigger?: React.ReactNode;
      openInitially?: boolean;
      onClose?: () => void;
    };

export function EmpresaContabilDrawer(props: Props) {
  const [open, setOpen] = React.useState(
    props.mode === "editar" ? !!(props as { openInitially?: boolean }).openInitially : false,
  );
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [sucesso, setSucesso] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  // BrasilAPI prefill
  const [cnpjLoading, setCnpjLoading] = React.useState(false);
  const [cnpjError, setCnpjError] = React.useState<string | null>(null);
  const razaoSocialRef = React.useRef<HTMLInputElement>(null);
  const nomeFantasiaRef = React.useRef<HTMLInputElement>(null);

  const empresa = props.mode === "editar" ? props.empresa : undefined;

  function reset() {
    setError(null);
    setSucesso(null);
    setFieldErrors({});
    setCnpjError(null);
  }

  function handleOpenChange(o: boolean) {
    setOpen(o);
    if (!o) {
      reset();
      if (props.mode === "editar") {
        (props as { onClose?: () => void }).onClose?.();
      }
    }
  }

  async function handleCnpjBlur(e: React.FocusEvent<HTMLInputElement>) {
    const digits = apenasDigitos(e.target.value);
    // Formata o campo visualmente
    e.target.value = formatarCNPJ(digits);

    if (digits.length !== 14) return;
    // Só prefill em modo criar, e só se os campos de nome estiverem vazios
    if (props.mode !== "criar") return;
    if (razaoSocialRef.current?.value || nomeFantasiaRef.current?.value) return;

    setCnpjLoading(true);
    setCnpjError(null);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(
        `https://brasilapi.com.br/api/cnpj/v1/${digits}`,
        { signal: ctrl.signal },
      );
      clearTimeout(to);
      if (r.status === 404) {
        setCnpjError("CNPJ não encontrado na Receita Federal.");
        return;
      }
      if (!r.ok) return; // Falha silenciosa — usuário preenche manualmente

      const data = await r.json();
      if (razaoSocialRef.current && !razaoSocialRef.current.value) {
        razaoSocialRef.current.value = data.razao_social ?? "";
      }
      if (nomeFantasiaRef.current && !nomeFantasiaRef.current.value) {
        nomeFantasiaRef.current.value = data.nome_fantasia ?? "";
      }
    } catch {
      clearTimeout(to);
      // AbortError ou fetch error — silêncio, o usuário preenche manualmente
    } finally {
      setCnpjLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    reset();

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const res: ActionResult =
        props.mode === "editar"
          ? await editarEmpresaContabil(props.empresa.id, formData)
          : await criarEmpresaContabil(formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      setSucesso(
        props.mode === "editar"
          ? "Empresa contábil atualizada."
          : "Empresa contábil cadastrada.",
      );
      setTimeout(() => handleOpenChange(false), 1000);
    });
  }

  const erroClasses = (name: string) =>
    fieldErrors[name]?.length
      ? "border-california-red ring-2 ring-california-red/15"
      : "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {props.mode === "criar" && (
        <DialogTrigger asChild>
          {props.trigger ?? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
            >
              <Plus className="h-4 w-4" />
              Nova empresa contábil
            </button>
          )}
        </DialogTrigger>
      )}
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>
            {props.mode === "editar"
              ? "Editar empresa contábil"
              : "Nova empresa contábil"}
          </DialogTitle>
          <DialogDescription>
            PJ usada como emissora de notas fiscais e obrigações contábeis.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Identificação
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="CNPJ"
                  name="cnpj"
                  required
                  errors={fieldErrors}
                >
                  <Input
                    id="cnpj"
                    name="cnpj"
                    defaultValue={formatarCNPJ(empresa?.cnpj)}
                    className={erroClasses("cnpj")}
                    placeholder="00.000.000/0000-00"
                    onBlur={handleCnpjBlur}
                    disabled={cnpjLoading}
                  />
                  {cnpjLoading && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Consultando Receita Federal...
                    </p>
                  )}
                  {cnpjError && (
                    <p className="text-xs text-california-red mt-1">{cnpjError}</p>
                  )}
                </Field>

                <div />

                <Field
                  label="Razão social"
                  name="razao_social"
                  required
                  errors={fieldErrors}
                >
                  <Input
                    id="razao_social"
                    ref={razaoSocialRef}
                    name="razao_social"
                    defaultValue={empresa?.razao_social ?? ""}
                    className={erroClasses("razao_social")}
                    autoFocus={props.mode === "editar"}
                    maxLength={200}
                  />
                </Field>

                <Field
                  label="Nome fantasia"
                  name="nome_fantasia"
                  errors={fieldErrors}
                >
                  <Input
                    id="nome_fantasia"
                    ref={nomeFantasiaRef}
                    name="nome_fantasia"
                    defaultValue={empresa?.nome_fantasia ?? ""}
                    maxLength={200}
                    placeholder="Opcional"
                  />
                </Field>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {sucesso && (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{sucesso}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending || !!sucesso}
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
                  Salvar
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
