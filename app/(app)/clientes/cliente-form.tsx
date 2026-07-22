"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MaskedInput } from "@/components/ui/masked-input";
import { onlyDigits } from "@/lib/utils";
import type { Cliente } from "@/lib/types";
import {
  atualizarCliente,
  criarCliente,
  type ActionResult,
} from "./actions";

interface Props {
  cliente?: Cliente;
}

export function ClienteForm({ cliente }: Props) {
  const router = useRouter();
  const isEdit = Boolean(cliente);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    // Normaliza documento/telefone para dígitos antes de enviar.
    formData.set("cnpj", onlyDigits(formData.get("cnpj")?.toString()));
    formData.set("telefone", onlyDigits(formData.get("telefone")?.toString()));

    startTransition(async () => {
      const res: ActionResult = isEdit
        ? await atualizarCliente(cliente!.id, formData)
        : await criarCliente(formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      // criar já redireciona no server; atualizar dá refresh.
      if (isEdit) router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nome fantasia" name="nome_fantasia" required errors={fieldErrors}>
          <Input
            name="nome_fantasia"
            defaultValue={cliente?.nome_fantasia ?? ""}
            required
            autoFocus
          />
        </Field>

        <Field label="Razão social" name="razao_social" errors={fieldErrors}>
          <Input name="razao_social" defaultValue={cliente?.razao_social ?? ""} />
        </Field>

        <Field label="CNPJ" name="cnpj" errors={fieldErrors}>
          <MaskedInput mask="cnpj" name="cnpj" defaultValue={cliente?.cnpj ?? ""} />
        </Field>

        <Field label="E-mail" name="email" errors={fieldErrors}>
          <Input
            name="email"
            type="email"
            defaultValue={cliente?.email ?? ""}
            placeholder="contato@empresa.com"
          />
        </Field>

        <Field label="Telefone" name="telefone" errors={fieldErrors}>
          <MaskedInput
            mask="telefone"
            name="telefone"
            defaultValue={cliente?.telefone ?? ""}
          />
        </Field>
      </div>

      <Field label="Observações" name="observacoes" errors={fieldErrors}>
        <Textarea
          name="observacoes"
          defaultValue={cliente?.observacoes ?? ""}
          rows={4}
          placeholder="Contexto interno, contato-chave, particularidades da conta..."
        />
      </Field>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
        <Link
          href="/clientes"
          className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
        >
          Cancelar
        </Link>
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
              {isEdit ? "Salvar alterações" : "Criar cliente"}
            </>
          )}
        </button>
      </div>
    </form>
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
