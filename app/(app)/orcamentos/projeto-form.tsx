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
import { MultiSelect } from "@/components/ui/multi-select";
import { Textarea } from "@/components/ui/textarea";
import { DESCRICAO_MAX } from "@/lib/validations/projetos";
import type {
  CategoriaDominio,
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

/** Produto do cadastro do cliente. Vem com `cliente_id` porque a lista
 *  chega inteira e é filtrada no cliente conforme a seleção. */
export interface ProdutoOption {
  id: string;
  nome: string;
  codigo: string;
  cliente_id: string;
}

interface Props {
  projeto?: Projeto;
  empresas: { id: string; razao_social: string; nome_fantasia: string | null; principal: boolean }[];
  empresaPrincipalId?: string;
  clientes: Pick<Cliente, "id" | "nome_fantasia" | "codigo_curto">[];
  responsaveis: Pick<Profile, "id" | "nome">[];
  regionais: Pick<Regional, "id" | "nome">[];
  produtos: ProdutoOption[];
  categorias: Pick<CategoriaDominio, "id" | "nome">[];
  /** Ids já vinculados ao projeto, na ordem gravada. */
  regionaisSelecionadas?: string[];
  responsaveisSelecionados?: string[];
  /** Acréscimos manuais à Equipe já gravados (papel `equipe`). Os
   *  automáticos NÃO vêm aqui: são derivados na hora. */
  equipeSelecionada?: string[];
  /** Quem já é produtor de algum orçamento do projeto. Entra na Equipe
   *  travado, junto do criador e dos GPs. Vazio na criação — o projeto
   *  ainda não tem orçamento. */
  produtoresDosOrcamentos?: string[];
  /** Quem criou o projeto. Na criação é quem está logado. */
  criadorId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ProjetoForm({
  projeto,
  empresas,
  empresaPrincipalId,
  clientes,
  responsaveis,
  regionais,
  produtos,
  categorias,
  regionaisSelecionadas,
  responsaveisSelecionados,
  equipeSelecionada,
  produtoresDosOrcamentos,
  criadorId,
  onSuccess,
  onCancel,
}: Props) {
  const router = useRouter();
  const isEdit = Boolean(projeto);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [empresaId, setEmpresaId] = React.useState(
    projeto?.empresa_id ?? empresaPrincipalId ?? "",
  );
  const [clienteId, setClienteId] = React.useState(projeto?.cliente_id ?? "");
  const [produtoId, setProdutoId] = React.useState(projeto?.produto_id ?? "");
  const [responsavelIds, setResponsavelIds] = React.useState<string[]>(
    responsaveisSelecionados ?? (projeto ? [projeto.responsavel_id] : []),
  );
  const [regionalIds, setRegionalIds] = React.useState<string[]>(
    regionaisSelecionadas ?? (projeto?.regional_id ? [projeto.regional_id] : []),
  );
  const [descricao, setDescricao] = React.useState(projeto?.descricao ?? "");
  // Só os ACRÉSCIMOS manuais. Os automáticos entram por derivação abaixo.
  const [equipeManual, setEquipeManual] = React.useState<string[]>(
    equipeSelecionada ?? [],
  );

  /**
   * Equipe travada: criador do projeto, GPs Responsáveis e produtores dos
   * orçamentos. Regra do Tiago (02/09/2026) — esses três entram sozinhos e
   * não podem ser removidos, o que é o que garante que o campo, sendo
   * obrigatório, nunca fique vazio.
   *
   * Derivada, não copiada: os GPs vivem no campo ao lado e mudam enquanto
   * o formulário está aberto, e os produtores só existem depois que há
   * orçamento. Copiar exigiria re-sincronizar nos dois casos.
   */
  const equipeTravada = React.useMemo(() => {
    const ids = new Set<string>();
    if (criadorId) ids.add(criadorId);
    for (const id of responsavelIds) ids.add(id);
    for (const id of produtoresDosOrcamentos ?? []) ids.add(id);
    return Array.from(ids);
  }, [criadorId, responsavelIds, produtoresDosOrcamentos]);

  /** O que o campo mostra: travados primeiro, na ordem, depois o resto. */
  const equipeVisivel = React.useMemo(() => {
    const travados = new Set(equipeTravada);
    return [...equipeTravada, ...equipeManual.filter((id) => !travados.has(id))];
  }, [equipeTravada, equipeManual]);

  // Produto é cadastrado por cliente: trocar de cliente invalida a escolha.
  const produtosDoCliente = React.useMemo(
    () => produtos.filter((p) => p.cliente_id === clienteId),
    [produtos, clienteId],
  );

  function handleClienteChange(novoClienteId: string) {
    setClienteId(novoClienteId);
    if (novoClienteId !== clienteId) setProdutoId("");
  }

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
    formData.set("empresa_id", empresaId);
    formData.set("cliente_id", clienteId);
    formData.set("produto_id", produtoId);
    // Só os acréscimos manuais vão ao servidor: os travados ele deriva de
    // novo, e mandá-los daqui abriria caminho para um payload adulterado
    // gravar alguém como equipe manual.
    for (const id of equipeManual) formData.append("equipe_ids", id);
    // `append` numa chave repetida: o servidor lê com `getAll` e a ordem
    // define quem vai para as colunas de compatibilidade do projeto.
    for (const id of responsavelIds) formData.append("responsavel_ids", id);
    for (const id of regionalIds) formData.append("regional_ids", id);

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
        <Field label="Empresa" name="empresa_id" required errors={fieldErrors}>
          <Select value={empresaId} onValueChange={setEmpresaId}>
            <SelectTrigger className={erroClasses("empresa_id")}>
              <SelectValue placeholder="Selecione a empresa" />
            </SelectTrigger>
            <SelectContent
              side="bottom"
              avoidCollisions={false}
              className="w-[--radix-select-trigger-width]"
            >
              {empresas.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.nome_fantasia ?? e.razao_social}
                  {e.principal && (
                    <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                      principal
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

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

        <Field label="Cliente" name="cliente_id" required errors={fieldErrors}>
          <Select value={clienteId} onValueChange={handleClienteChange}>
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

        <Field label="Marca" name="produto_id" required errors={fieldErrors}>
          <Select
            value={produtoId}
            onValueChange={setProdutoId}
            disabled={!clienteId || produtosDoCliente.length === 0}
          >
            <SelectTrigger className={erroClasses("produto_id")}>
              <SelectValue
                placeholder={
                  !clienteId
                    ? "Selecione o cliente primeiro"
                    : produtosDoCliente.length === 0
                      ? "Nenhuma marca cadastrada"
                      : "Selecione a marca"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {produtosDoCliente.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nome}{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {p.codigo}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {clienteId && produtosDoCliente.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Este cliente ainda não tem marcas.{" "}
              <Link
                href={`/clientes/${clienteId}`}
                prefetch={false}
                className="font-medium text-california-red hover:underline"
              >
                Cadastrar agora
              </Link>
            </p>
          )}
        </Field>

        <Field label="Regionais" name="regional_ids" required errors={fieldErrors}>
          <MultiSelect
            items={regionais.map((r) => ({ value: r.id, label: r.nome }))}
            value={regionalIds}
            onChange={setRegionalIds}
            placeholder="Selecione uma ou mais regionais"
            vazio="Nenhuma regional ativa cadastrada."
            className={erroClasses("regional_ids")}
          />
        </Field>

        {/* Serviço saiu daqui em 02/09/2026 (decisão 037): ele descreve o
            trabalho de um job, não a iniciativa inteira do cliente, e
            agora vive no formulário do orçamento. GPs Responsáveis ocupa a
            vaga, ao lado de Regionais, como no design. */}
        <Field
          label="GPs Responsáveis"
          name="responsavel_ids"
          required
          errors={fieldErrors}
        >
          <MultiSelect
            items={responsaveis.map((r) => ({ value: r.id, label: r.nome }))}
            value={responsavelIds}
            onChange={setResponsavelIds}
            placeholder="Selecione um ou mais GPs"
            className={erroClasses("responsavel_ids")}
          />
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

        {/* Equipe — obrigatória, e nunca vazia por construção: criador,
            GPs e produtores dos orçamentos entram travados (sem "x"). O
            campo aceita acrescentar quem mais participa. */}
        <Field label="Equipe" name="equipe_ids" required errors={fieldErrors}>
          <MultiSelect
            items={responsaveis.map((r) => ({ value: r.id, label: r.nome }))}
            value={equipeVisivel}
            travados={equipeTravada}
            onChange={(ids) =>
              // Guarda só o que não é travado: o resto é derivado e voltaria
              // sozinho no próximo render de qualquer forma.
              setEquipeManual(ids.filter((id) => !equipeTravada.includes(id)))
            }
            placeholder="Selecione quem participa do projeto"
            className={erroClasses("equipe_ids")}
          />
          <p className="text-xs text-muted-foreground">
            Criador, GPs Responsáveis e produtores dos orçamentos entram
            automaticamente e não podem ser removidos.
          </p>
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
