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
import { Textarea } from "@/components/ui/textarea";
import { DESCRICAO_MAX } from "@/lib/validations/projetos";
import type {
  CategoriaDominio,
  Cidade,
  Cliente,
  Profile,
  Projeto,
  Regional,
} from "@/lib/types";
import {
  atualizarProjeto,
  criarProjeto,
  type ActionResult,
} from "./actions";

interface Props {
  projeto?: Projeto;
  clientes: Pick<Cliente, "id" | "nome_fantasia" | "codigo_curto">[];
  responsaveis: Pick<Profile, "id" | "nome">[];
  regionais: Pick<Regional, "id" | "nome">[];
  cidades: Pick<Cidade, "id" | "nome">[];
  categorias: Pick<CategoriaDominio, "id" | "nome">[];
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ProjetoForm({
  projeto,
  clientes,
  responsaveis,
  regionais,
  cidades,
  categorias,
  onSuccess,
  onCancel,
}: Props) {
  const router = useRouter();
  const isEdit = Boolean(projeto);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [clienteId, setClienteId] = React.useState(projeto?.cliente_id ?? "");
  const [responsavelId, setResponsavelId] = React.useState(
    projeto?.responsavel_id ?? "",
  );
  const [regionalId, setRegionalId] = React.useState(projeto?.regional_id ?? "");
  const [cidadeId, setCidadeId] = React.useState(projeto?.cidade_id ?? "");
  const [categoriaId, setCategoriaId] = React.useState(projeto?.categoria_id ?? "");
  const [descricao, setDescricao] = React.useState(projeto?.descricao ?? "");

  /** Realce do campo com erro, como no handoff: borda vermelha + halo.
   *  Os Selects NÃO usam `required`: o Radix monta um <select> nativo
   *  escondido e o navegador barraria o envio com tooltip em inglês,
   *  antes das mensagens em português do Zod chegarem à tela. */
  const erroClasses = (name: string) =>
    fieldErrors[name]?.length
      ? "border-california-red ring-2 ring-california-red/15"
      : "";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    formData.set("cliente_id", clienteId);
    formData.set("responsavel_id", responsavelId);
    formData.set("regional_id", regionalId);
    formData.set("cidade_id", cidadeId);
    formData.set("categoria_id", categoriaId);

    startTransition(async () => {
      const res: ActionResult = isEdit
        ? await atualizarProjeto(projeto!.id, formData)
        : await criarProjeto(formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      if (isEdit) {
        router.refresh();
        onSuccess?.();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Nome divide a primeira linha com Responsável. */}
        <Field label="Nome do projeto" name="nome" required errors={fieldErrors}>
          <Input
            name="nome"
            defaultValue={projeto?.nome ?? ""}
            className={erroClasses("nome")}
            autoFocus
            placeholder="Ex.: Carnaval Anitta"
          />
        </Field>

        <Field
          label="Responsável"
          name="responsavel_id"
          required
          errors={fieldErrors}
        >
          <Select value={responsavelId} onValueChange={setResponsavelId}>
            <SelectTrigger className={erroClasses("responsavel_id")}>
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

        <Field label="Cliente" name="cliente_id" required errors={fieldErrors}>
          <Select value={clienteId} onValueChange={setClienteId}>
            <SelectTrigger className={erroClasses("cliente_id")}>
              <SelectValue placeholder="Selecione um cliente ativo" />
            </SelectTrigger>
            <SelectContent>
              {clientes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome_fantasia}{" "}
                  <span className="text-muted-foreground">({c.codigo_curto})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Regional" name="regional_id" required errors={fieldErrors}>
          <Select value={regionalId} onValueChange={setRegionalId}>
            <SelectTrigger className={erroClasses("regional_id")}>
              <SelectValue placeholder="Selecione a regional" />
            </SelectTrigger>
            <SelectContent>
              {regionais.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Cidade" name="cidade_id" required errors={fieldErrors}>
          <Select value={cidadeId} onValueChange={setCidadeId}>
            <SelectTrigger className={erroClasses("cidade_id")}>
              <SelectValue placeholder="Selecione a cidade" />
            </SelectTrigger>
            <SelectContent>
              {cidades.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Categoria" name="categoria_id" required errors={fieldErrors}>
          <Select value={categoriaId} onValueChange={setCategoriaId}>
            <SelectTrigger className={erroClasses("categoria_id")}>
              <SelectValue placeholder="Selecione uma categoria" />
            </SelectTrigger>
            <SelectContent>
              {categorias.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Início previsto"
          name="data_inicio_prevista"
          required
          errors={fieldErrors}
        >
          <DatePicker
            name="data_inicio_prevista"
            defaultValue={projeto?.data_inicio_prevista ?? ""}
            className={erroClasses("data_inicio_prevista")}
            placeholder="Selecione a data"
          />
        </Field>

        <Field
          label="Final previsto"
          name="data_fim_prevista"
          required
          errors={fieldErrors}
        >
          <DatePicker
            name="data_fim_prevista"
            defaultValue={projeto?.data_fim_prevista ?? ""}
            className={erroClasses("data_fim_prevista")}
            placeholder="Selecione a data"
          />
        </Field>

        <div className="md:col-span-2">
          <Field
            label="Descrição"
            name="descricao"
            opcional
            errors={fieldErrors}
          >
            <Textarea
              name="descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={DESCRICAO_MAX}
              rows={4}
              className="min-h-[104px] resize-y leading-relaxed"
              placeholder="Contexto, entregáveis, observações internas sobre o projeto…"
            />
            {/* Contador só aparece com texto — não polui o formulário vazio. */}
            {descricao.length > 0 && (
              <span className="block self-end text-right text-[11px] text-muted-foreground">
                {descricao.length} / {DESCRICAO_MAX}
              </span>
            )}
          </Field>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
        ) : (
          <Link
            href={isEdit ? `/orcamentos/${projeto!.id}` : "/orcamentos"}
            className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
          >
            Cancelar
          </Link>
        )}
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
              {isEdit ? "Salvar alterações" : "Criar projeto"}
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
  opcional,
  errors,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  /** Marca "Opcional" à direita do rótulo, como no handoff. */
  opcional?: boolean;
  errors: Record<string, string[]>;
  children: React.ReactNode;
}) {
  const fieldErrors = errors[name];
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={name}>
          {label}
          {required && <span className="text-california-red ml-1">*</span>}
        </Label>
        {opcional && (
          <span className="text-[11px] text-muted-foreground">Opcional</span>
        )}
      </div>
      {children}
      {fieldErrors?.map((msg, i) => (
        <p key={i} className="text-xs text-california-red">
          {msg}
        </p>
      ))}
    </div>
  );
}
