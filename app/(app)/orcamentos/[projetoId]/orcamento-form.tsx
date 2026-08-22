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
  type Orcamento,
  type OrcamentoStatus,
  type Profile,
  type Regional,
} from "@/lib/types";
import { orcamentoSchema } from "@/lib/validations/orcamentos";
import { CidadeCombobox, type CidadeOption } from "../cidade-combobox";
import {
  atualizarOrcamento,
  criarOrcamento,
  type ActionResult,
} from "./actions";

/** Os campos do orçamento sem nada de banco — o que o editor de orçamento
 *  do projeto guarda no rascunho até o "Salvar orçamentos". */
export interface DadosOrcamento {
  nome: string;
  categoria_id: string;
  regional_id: string;
  cidade_id: string;
  /** Nome da cidade escolhida. Vai junto porque quem consome o rascunho
   *  não tem mais a lista completa para resolver o id — o combobox busca
   *  no servidor e só ele conhece o par. */
  cidade_nome: string;
  gp_responsavel_id: string;
  produtor_id: string;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
}

interface Props {
  projetoId: string;
  orcamento?: Orcamento;
  categorias: Pick<CategoriaDominio, "id" | "nome">[];
  /** Só as regionais cadastradas no projeto — a peça não sai da praça
   *  que a iniciativa cobre. */
  regionaisDoProjeto: Pick<Regional, "id" | "nome">[];
  /** Primeiras cidades do cadastro, só para o combobox não abrir vazio —
   *  o resto é buscado no servidor a cada digitação. */
  cidadesIniciais: CidadeOption[];
  /** Cidade já gravada no orçamento, com o nome resolvido no servidor.
   *  Sem ela o combobox abriria sem rótulo em edição. */
  cidadeAtual?: CidadeOption | null;
  /** GP responsável sai dos responsáveis do projeto. */
  gpsDoProjeto: Pick<Profile, "id" | "nome">[];
  /** Produtor sai de todos os membros ativos — o time de produção ainda
   *  não está modelado como papel próprio. */
  produtores: Pick<Profile, "id" | "nome">[];
  onSuccess?: () => void;
  onCancel?: () => void;
  /** Presente ⇒ o formulário não grava nada: valida com o mesmo schema e
   *  devolve os campos para quem chamou. É assim que o editor de orçamento
   *  do projeto usa este formulário sem tocar no banco. */
  onRascunho?: (dados: DadosOrcamento) => void;
  /** Rótulo do botão de envio. O padrão serve à tela de sempre. */
  rotuloSubmit?: string;
}

export function OrcamentoForm({
  projetoId,
  orcamento,
  categorias,
  regionaisDoProjeto,
  cidadesIniciais,
  cidadeAtual,
  gpsDoProjeto,
  produtores,
  onSuccess,
  onCancel,
  onRascunho,
  rotuloSubmit,
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
  // Categoria é obrigatória desde 17/08/2026: sem opção "Sem categoria",
  // estado inicial vazio mostra o placeholder e o Zod cobra a escolha.
  const [categoriaId, setCategoriaId] = React.useState(
    orcamento?.categoria_id ?? "",
  );
  const [regionalId, setRegionalId] = React.useState(orcamento?.regional_id ?? "");
  const [cidade, setCidade] = React.useState<CidadeOption | null>(
    cidadeAtual ?? null,
  );
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
    formData.set("categoria_id", categoriaId);
    formData.set("regional_id", regionalId);
    formData.set("cidade_id", cidade?.id ?? "");
    formData.set("gp_responsavel_id", gpId);
    formData.set("produtor_id", produtorId);

    // Modo rascunho: a mesma validação, sem ida ao servidor. O que sai
    // daqui entra na lista do editor e só vira registro no salvamento.
    if (onRascunho) {
      const parsed = orcamentoSchema.safeParse({
        codigo: "",
        nome: formData.get("nome")?.toString() ?? "",
        status: "rascunho",
        categoria_id: formData.get("categoria_id")?.toString() ?? "",
        regional_id: regionalId,
        cidade_id: cidade?.id ?? "",
        gp_responsavel_id: gpId,
        produtor_id: produtorId,
        data_inicio_prevista:
          formData.get("data_inicio_prevista")?.toString() ?? "",
        data_fim_prevista: formData.get("data_fim_prevista")?.toString() ?? "",
      });
      if (!parsed.success) {
        setError("Verifique os campos destacados.");
        setFieldErrors(parsed.error.flatten().fieldErrors);
        return;
      }
      const { codigo: _semCodigo, status: _semStatus, ...dados } = parsed.data;
      onRascunho({ ...dados, cidade_nome: cidade?.nome ?? "" });
      return;
    }

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
        <Field label="Nome do Job" name="nome" required errors={fieldErrors}>
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

        <Field label="Categoria" name="categoria_id" required errors={fieldErrors}>
          <Select value={categoriaId} onValueChange={setCategoriaId}>
            <SelectTrigger className={erroClasses("categoria_id")}>
              <SelectValue placeholder="Selecione a categoria" />
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
          <CidadeCombobox
            value={cidade}
            onChange={setCidade}
            iniciais={cidadesIniciais}
            erro={Boolean(fieldErrors["cidade_id"]?.length)}
          />
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
              {rotuloSubmit ?? (isEdit ? "Salvar alterações" : "Criar orçamento")}
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
