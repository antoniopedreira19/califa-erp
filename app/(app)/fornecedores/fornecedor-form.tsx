"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MaskedInput } from "@/components/ui/masked-input";
import { onlyDigits, cn } from "@/lib/utils";
import type { Fornecedor, TipoPessoa } from "@/lib/types";
import {
  atualizarFornecedor,
  criarFornecedor,
  type ActionResult,
} from "./actions";

interface Props {
  fornecedor?: Fornecedor;
}

export function FornecedorForm({ fornecedor }: Props) {
  const router = useRouter();
  const isEdit = Boolean(fornecedor);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [tipoPessoa, setTipoPessoa] = React.useState<TipoPessoa>(
    fornecedor?.tipo_pessoa ?? "juridica",
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    formData.set("tipo_pessoa", tipoPessoa);
    formData.set("cpf_cnpj", onlyDigits(formData.get("cpf_cnpj")?.toString()));
    formData.set("telefone", onlyDigits(formData.get("telefone")?.toString()));

    startTransition(async () => {
      const res: ActionResult = isEdit
        ? await atualizarFornecedor(fornecedor!.id, formData)
        : await criarFornecedor(formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      if (isEdit) router.refresh();
    });
  }

  // Documento inicial só é reutilizado quando o tipo_pessoa carregado
  // bate com o tipo atual (evita mostrar CPF antigo quando usuário
  // alterna para PJ).
  const initialDoc =
    fornecedor?.cpf_cnpj && fornecedor.tipo_pessoa === tipoPessoa
      ? fornecedor.cpf_cnpj
      : "";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Toggle PF / PJ */}
      <div className="space-y-2">
        <Label>Tipo de pessoa</Label>
        <div className="inline-flex rounded-lg border border-border bg-white p-1">
          {(["juridica", "fisica"] as const).map((tp) => (
            <button
              type="button"
              key={tp}
              onClick={() => setTipoPessoa(tp)}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
                tipoPessoa === tp
                  ? "bg-california-red text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tp === "juridica" ? "Pessoa Jurídica" : "Pessoa Física"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={tipoPessoa === "fisica" ? "Nome" : "Nome fantasia"} name="nome" required errors={fieldErrors}>
          <Input name="nome" defaultValue={fornecedor?.nome ?? ""} required autoFocus />
        </Field>

        {tipoPessoa === "juridica" && (
          <Field label="Razão social" name="razao_social" errors={fieldErrors}>
            <Input name="razao_social" defaultValue={fornecedor?.razao_social ?? ""} />
          </Field>
        )}

        <Field label={tipoPessoa === "fisica" ? "CPF" : "CNPJ"} name="cpf_cnpj" errors={fieldErrors}>
          <MaskedInput
            // key força remount ao trocar PF/PJ (reinicia estado com nova máscara)
            key={tipoPessoa}
            mask={tipoPessoa === "fisica" ? "cpf" : "cnpj"}
            name="cpf_cnpj"
            defaultValue={initialDoc}
          />
        </Field>

        <Field label="E-mail" name="email" errors={fieldErrors}>
          <Input name="email" type="email" defaultValue={fornecedor?.email ?? ""} />
        </Field>

        <Field label="Telefone" name="telefone" errors={fieldErrors}>
          <MaskedInput
            mask="telefone"
            name="telefone"
            defaultValue={fornecedor?.telefone ?? ""}
          />
        </Field>
      </div>

      <Field label="Observações" name="observacoes" errors={fieldErrors}>
        <Textarea
          name="observacoes"
          defaultValue={fornecedor?.observacoes ?? ""}
          rows={4}
          placeholder="Especialidade, chave PIX, forma de pagamento habitual..."
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
          href="/fornecedores"
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
              {isEdit ? "Salvar alterações" : "Criar fornecedor"}
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
