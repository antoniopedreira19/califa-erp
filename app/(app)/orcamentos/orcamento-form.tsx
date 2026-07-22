"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import {
  ORCAMENTO_STATUS_EDITAVEIS,
  orcamentoStatusLabel,
  type Cliente,
  type Orcamento,
  type OrcamentoStatus,
  type Profile,
} from "@/lib/types";
import {
  atualizarOrcamento,
  criarOrcamento,
  type ActionResult,
} from "./actions";

interface Props {
  orcamento?: Orcamento;
  clientes: Pick<Cliente, "id" | "nome_fantasia">[];
  responsaveis: Pick<Profile, "id" | "nome">[];
}

export function OrcamentoForm({ orcamento, clientes, responsaveis }: Props) {
  const router = useRouter();
  const isEdit = Boolean(orcamento);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  // Radix Select não integra com FormData automaticamente — mantenho o
  // valor selecionado em state controlado e injeto no submit.
  const [clienteId, setClienteId] = React.useState(orcamento?.cliente_id ?? "");
  const [responsavelId, setResponsavelId] = React.useState(
    orcamento?.responsavel_id ?? "",
  );
  const [status, setStatus] = React.useState<OrcamentoStatus>(
    orcamento?.status && ORCAMENTO_STATUS_EDITAVEIS.includes(orcamento.status)
      ? orcamento.status
      : "rascunho",
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    formData.set("cliente_id", clienteId);
    formData.set("responsavel_id", responsavelId);
    if (isEdit) formData.set("status", status);

    startTransition(async () => {
      const res: ActionResult = isEdit
        ? await atualizarOrcamento(orcamento!.id, formData)
        : await criarOrcamento(formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      if (isEdit) router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nome do orçamento" name="nome" required errors={fieldErrors}>
          <Input
            name="nome"
            defaultValue={orcamento?.nome ?? ""}
            required
            autoFocus
            placeholder="Ex.: Campanha Q3 · Marca X"
          />
        </Field>

        {isEdit && (
          <Field label="Código" name="codigo" errors={fieldErrors}>
            <Input
              name="codigo"
              defaultValue={orcamento?.codigo ?? ""}
              placeholder="ORC-NNNN"
            />
          </Field>
        )}

        <Field label="Cliente" name="cliente_id" required errors={fieldErrors}>
          <Select value={clienteId} onValueChange={setClienteId} required>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um cliente ativo" />
            </SelectTrigger>
            <SelectContent>
              {clientes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome_fantasia}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Responsável" name="responsavel_id" required errors={fieldErrors}>
          <Select
            value={responsavelId}
            onValueChange={setResponsavelId}
            required
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione um membro do tenant" />
            </SelectTrigger>
            <SelectContent>
              {responsaveis.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {isEdit && (
          <Field label="Tipo" name="tipo" errors={fieldErrors}>
            <Input
              name="tipo"
              defaultValue={orcamento?.tipo ?? ""}
              placeholder="Ex.: Campanha, Retainer, Projeto único"
            />
          </Field>
        )}

        {isEdit && (
          <Field label="Campanha" name="campanha" errors={fieldErrors}>
            <Input
              name="campanha"
              defaultValue={orcamento?.campanha ?? ""}
              placeholder="Nome da campanha ou ação"
            />
          </Field>
        )}

        <Field label="Início previsto" name="data_inicio_prevista" errors={fieldErrors}>
          <DatePicker
            name="data_inicio_prevista"
            defaultValue={orcamento?.data_inicio_prevista ?? ""}
            placeholder="Selecione a data"
          />
        </Field>

        <Field label="Fim previsto" name="data_fim_prevista" errors={fieldErrors}>
          <DatePicker
            name="data_fim_prevista"
            defaultValue={orcamento?.data_fim_prevista ?? ""}
            placeholder="Selecione a data"
          />
        </Field>

        {isEdit && (
          <Field label="Status" name="status" errors={fieldErrors}>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as OrcamentoStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORCAMENTO_STATUS_EDITAVEIS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {orcamentoStatusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              &quot;Aprovado&quot; e &quot;Job criado&quot; são setados automaticamente pelas Tasks 004 e 005.
            </p>
          </Field>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
        <Link
          href={isEdit ? `/orcamentos/${orcamento!.id}` : "/orcamentos"}
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
              {isEdit ? "Salvar alterações" : "Criar orçamento"}
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
