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
  type CategoriaDominio,
  type Cidade,
  type Orcamento,
  type OrcamentoStatus,
  type Profile,
  type Regional,
} from "@/lib/types";
import {
  atualizarOrcamento,
  criarOrcamento,
  type ActionResult,
} from "./actions";

interface Props {
  projetoId: string;
  orcamento?: Orcamento;
  categorias: Pick<CategoriaDominio, "id" | "nome">[];
  /** Só as regionais cadastradas no projeto — a peça não sai da praça
   *  que a iniciativa cobre. */
  regionaisDoProjeto: Pick<Regional, "id" | "nome">[];
  cidades: Pick<Cidade, "id" | "nome">[];
  /** GP responsável sai dos responsáveis do projeto. */
  gpsDoProjeto: Pick<Profile, "id" | "nome">[];
  /** Produtor sai de todos os membros ativos — o time de produção ainda
   *  não está modelado como papel próprio. */
  produtores: Pick<Profile, "id" | "nome">[];
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function OrcamentoForm({
  projetoId,
  orcamento,
  categorias,
  regionaisDoProjeto,
  cidades,
  gpsDoProjeto,
  produtores,
  onSuccess,
  onCancel,
}: Props) {
  const router = useRouter();
  const isEdit = Boolean(orcamento);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [status, setStatus] = React.useState<OrcamentoStatus>(
    orcamento?.status && ORCAMENTO_STATUS_EDITAVEIS.includes(orcamento.status)
      ? orcamento.status
      : "rascunho",
  );
  const SEM_CATEGORIA = "__none__";
  const [categoriaId, setCategoriaId] = React.useState(
    orcamento?.categoria_id ?? SEM_CATEGORIA,
  );
  const [regionalId, setRegionalId] = React.useState(orcamento?.regional_id ?? "");
  const [cidadeId, setCidadeId] = React.useState(orcamento?.cidade_id ?? "");
  const [gpId, setGpId] = React.useState(orcamento?.gp_responsavel_id ?? "");
  const [produtorId, setProdutorId] = React.useState(orcamento?.produtor_id ?? "");

  /** Realce do campo com erro. Os Selects não usam `required`: o Radix
   *  monta um <select> nativo escondido e o navegador barraria o envio
   *  com tooltip em inglês, antes das mensagens do Zod chegarem à tela. */
  const erroClasses = (name: string) =>
    fieldErrors[name]?.length
      ? "border-california-red ring-2 ring-california-red/15"
      : "";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);
    if (isEdit) formData.set("status", status);
    formData.set("categoria_id", categoriaId === SEM_CATEGORIA ? "" : categoriaId);
    formData.set("regional_id", regionalId);
    formData.set("cidade_id", cidadeId);
    formData.set("gp_responsavel_id", gpId);
    formData.set("produtor_id", produtorId);

    startTransition(async () => {
      const res: ActionResult = isEdit
        ? await atualizarOrcamento(projetoId, orcamento!.id, formData)
        : await criarOrcamento(projetoId, formData);

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
        <Field label="Nome do orçamento" name="nome" required errors={fieldErrors}>
          <Input
            name="nome"
            defaultValue={orcamento?.nome ?? ""}
            required
            autoFocus
            placeholder="Ex.: Bebedouros SP"
          />
        </Field>

        {isEdit && (
          <Field label="Código" name="codigo" errors={fieldErrors}>
            <Input
              name="codigo"
              defaultValue={orcamento?.codigo ?? ""}
              placeholder="Auto-gerado"
            />
          </Field>
        )}

        <Field label="Categoria" name="categoria_id" errors={fieldErrors}>
          <Select value={categoriaId} onValueChange={setCategoriaId}>
            <SelectTrigger className={erroClasses("categoria_id")}>
              <SelectValue placeholder="Sem categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_CATEGORIA}>Sem categoria</SelectItem>
              {categorias.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Regional" name="regional_id" required errors={fieldErrors}>
          <Select
            value={regionalId}
            onValueChange={setRegionalId}
            disabled={regionaisDoProjeto.length === 0}
          >
            <SelectTrigger className={erroClasses("regional_id")}>
              <SelectValue
                placeholder={
                  regionaisDoProjeto.length === 0
                    ? "Projeto sem regional cadastrada"
                    : "Selecione a regional"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {regionaisDoProjeto.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {regionaisDoProjeto.length === 0 && (
            <p className="text-xs text-muted-foreground">
              As opções vêm das regionais do projeto. Edite o projeto para
              cadastrar ao menos uma.
            </p>
          )}
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

        <Field
          label="GP Responsável"
          name="gp_responsavel_id"
          required
          errors={fieldErrors}
        >
          <Select
            value={gpId}
            onValueChange={setGpId}
            disabled={gpsDoProjeto.length === 0}
          >
            <SelectTrigger className={erroClasses("gp_responsavel_id")}>
              <SelectValue
                placeholder={
                  gpsDoProjeto.length === 0
                    ? "Projeto sem responsável cadastrado"
                    : "Selecione o GP responsável"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {gpsDoProjeto.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {gpsDoProjeto.length === 0 && (
            <p className="text-xs text-muted-foreground">
              As opções vêm dos responsáveis do projeto.
            </p>
          )}
        </Field>

        <Field
          label="Produtor Responsável"
          name="produtor_id"
          required
          errors={fieldErrors}
        >
          <Select value={produtorId} onValueChange={setProdutorId}>
            <SelectTrigger className={erroClasses("produtor_id")}>
              <SelectValue placeholder="Selecione o produtor responsável" />
            </SelectTrigger>
            <SelectContent>
              {produtores.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

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
            <Select value={status} onValueChange={(v) => setStatus(v as OrcamentoStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORCAMENTO_STATUS_EDITAVEIS.map((s) => (
                  <SelectItem key={s} value={s}>{orcamentoStatusLabel(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            href={isEdit ? `/orcamentos/${projetoId}/${orcamento!.id}` : `/orcamentos/${projetoId}`}
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
        <p key={i} className="text-xs text-california-red">{msg}</p>
      ))}
    </div>
  );
}
