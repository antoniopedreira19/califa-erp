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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Regional, UF } from "@/lib/types";
import { UFS, apenasDigitos, formatarCNPJ, formatarCEP, formatarTelefone } from "@/lib/utils/formato-fiscal";
import { criarEmpresa, atualizarEmpresa, type ActionResult } from "./actions";
import type { EmpresaRow } from "./empresas-list";

type Props =
  | {
      mode: "create";
      regionais: Pick<Regional, "id" | "nome">[];
    }
  | {
      mode: "edit";
      empresa: EmpresaRow;
      regionais: Pick<Regional, "id" | "nome">[];
      openInitially?: boolean;
      onClose?: () => void;
    };

export function EmpresaDrawer(props: Props) {
  const [open, setOpen] = React.useState(
    props.mode === "edit" ? !!props.openInitially : false,
  );
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [sucesso, setSucesso] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  // Estado dos Selects controlados (regional, UF).
  const empresa = props.mode === "edit" ? props.empresa : undefined;
  const [regionalId, setRegionalId] = React.useState(empresa?.regional_id ?? "");
  const [uf, setUf] = React.useState<UF | "">((empresa?.uf as UF | undefined) ?? "");
  const [principal, setPrincipal] = React.useState(empresa?.principal ?? false);

  function reset() {
    setError(null);
    setSucesso(null);
    setFieldErrors({});
  }

  function handleOpenChange(o: boolean) {
    setOpen(o);
    if (!o) {
      reset();
      if (props.mode === "edit") props.onClose?.();
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    reset();

    const formData = new FormData(e.currentTarget);
    formData.set("regional_id", regionalId);
    formData.set("uf", uf);
    formData.set("principal", principal ? "true" : "false");

    startTransition(async () => {
      const res: ActionResult =
        props.mode === "edit"
          ? await atualizarEmpresa(props.empresa.id, formData)
          : await criarEmpresa(formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      setSucesso(res.message ?? "Empresa salva.");
      setTimeout(() => handleOpenChange(false), 1000);
    });
  }

  const erroClasses = (name: string) =>
    fieldErrors[name]?.length
      ? "border-california-red ring-2 ring-california-red/15"
      : "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {props.mode === "create" && (
        <DialogTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
          >
            <Plus className="h-4 w-4" />
            Nova empresa
          </button>
        </DialogTrigger>
      )}
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>
            {props.mode === "edit" ? "Editar empresa" : "Nova empresa"}
          </DialogTitle>
          <DialogDescription>
            Dados fiscais e de contato usados por documentos emitidos por esta PJ.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <Section title="Identificação">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Razão social" name="razao_social" required errors={fieldErrors}>
                  <Input
                    name="razao_social"
                    defaultValue={empresa?.razao_social ?? ""}
                    className={erroClasses("razao_social")}
                    autoFocus
                    maxLength={200}
                  />
                </Field>
                <Field label="Nome fantasia" name="nome_fantasia" errors={fieldErrors}>
                  <Input
                    name="nome_fantasia"
                    defaultValue={empresa?.nome_fantasia ?? ""}
                    maxLength={200}
                  />
                </Field>
                <Field label="CNPJ" name="cnpj" required errors={fieldErrors}>
                  <Input
                    name="cnpj"
                    defaultValue={formatarCNPJ(empresa?.cnpj)}
                    className={erroClasses("cnpj")}
                    placeholder="00.000.000/0000-00"
                    onBlur={(e) => {
                      e.target.value = formatarCNPJ(apenasDigitos(e.target.value));
                    }}
                  />
                </Field>
                <Field label="Inscrição estadual" name="inscricao_estadual" errors={fieldErrors}>
                  <Input name="inscricao_estadual" defaultValue={empresa?.inscricao_estadual ?? ""} placeholder="ISENTO ou número" maxLength={30} />
                </Field>
                <Field label="Inscrição municipal" name="inscricao_municipal" errors={fieldErrors}>
                  <Input name="inscricao_municipal" defaultValue={empresa?.inscricao_municipal ?? ""} maxLength={30} />
                </Field>
              </div>
            </Section>

            <Section title="Endereço">
              <div className="grid gap-4 md:grid-cols-6">
                <div className="md:col-span-2">
                  <Field label="CEP" name="cep" required errors={fieldErrors}>
                    <Input
                      name="cep"
                      defaultValue={formatarCEP(empresa?.cep ?? "")}
                      className={erroClasses("cep")}
                      placeholder="00000-000"
                      onBlur={(e) => {
                        e.target.value = formatarCEP(apenasDigitos(e.target.value));
                      }}
                    />
                  </Field>
                </div>
                <div className="md:col-span-4">
                  <Field label="Logradouro" name="logradouro" required errors={fieldErrors}>
                    <Input name="logradouro" defaultValue={empresa?.logradouro ?? ""} className={erroClasses("logradouro")} maxLength={200} />
                  </Field>
                </div>
                <div className="md:col-span-1">
                  <Field label="Número" name="numero" errors={fieldErrors}>
                    <Input name="numero" defaultValue={empresa?.numero ?? ""} maxLength={20} />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label="Complemento" name="complemento" errors={fieldErrors}>
                    <Input name="complemento" defaultValue={empresa?.complemento ?? ""} maxLength={100} />
                  </Field>
                </div>
                <div className="md:col-span-3">
                  <Field label="Bairro" name="bairro" errors={fieldErrors}>
                    <Input name="bairro" defaultValue={empresa?.bairro ?? ""} maxLength={100} />
                  </Field>
                </div>
                <div className="md:col-span-4">
                  <Field label="Cidade" name="cidade" required errors={fieldErrors}>
                    <Input name="cidade" defaultValue={empresa?.cidade ?? ""} className={erroClasses("cidade")} maxLength={100} />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label="UF" name="uf" required errors={fieldErrors}>
                    <Select value={uf} onValueChange={(v) => setUf(v as UF)}>
                      <SelectTrigger className={erroClasses("uf")}>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent
                        side="bottom"
                        avoidCollisions={false}
                        className="w-[--radix-select-trigger-width]"
                      >
                        {UFS.map((u) => (
                          <SelectItem key={u} value={u}>{u}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>
            </Section>

            <Section title="Contato">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Telefone" name="telefone" errors={fieldErrors}>
                  <Input
                    name="telefone"
                    defaultValue={formatarTelefone(empresa?.telefone ?? "")}
                    placeholder="(00) 00000-0000"
                    onBlur={(e) => {
                      e.target.value = formatarTelefone(apenasDigitos(e.target.value));
                    }}
                  />
                </Field>
                <Field label="E-mail" name="email" errors={fieldErrors}>
                  <Input name="email" defaultValue={empresa?.email ?? ""} type="email" maxLength={200} />
                </Field>
              </div>
            </Section>

            <Section title="Faturamento">
              <Field label="Local de pagamento" name="local_pagamento" errors={fieldErrors}>
                <Input name="local_pagamento" defaultValue={empresa?.local_pagamento ?? ""} placeholder="Ex.: Salvador - BA" maxLength={200} />
              </Field>
              <Field label="Instruções para nota fiscal" name="instrucoes_nf" errors={fieldErrors}>
                <Textarea name="instrucoes_nf" defaultValue={empresa?.instrucoes_nf ?? ""} rows={3} maxLength={500} />
              </Field>
            </Section>

            <Section title="Classificação">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Regional" name="regional_id" required errors={fieldErrors}>
                  <Select value={regionalId} onValueChange={setRegionalId}>
                    <SelectTrigger className={erroClasses("regional_id")}>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent
                      side="bottom"
                      avoidCollisions={false}
                      className="w-[--radix-select-trigger-width]"
                    >
                      {props.regionais.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={principal}
                      onChange={(e) => setPrincipal(e.target.checked)}
                      className="h-4 w-4 rounded border-border text-california-red focus:ring-california-red"
                    />
                    <span>Marcar como <b>principal</b> do tenant</span>
                  </label>
                </div>
              </div>
            </Section>

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
                  {props.mode === "edit" ? "Salvar alterações" : "Cadastrar"}
                </>
              )}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
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
        <p key={i} className="text-xs text-california-red">{msg}</p>
      ))}
    </div>
  );
}
