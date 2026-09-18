"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Plus, Save } from "lucide-react";
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
import {
  CampoCliente,
  type ClienteDoCampo,
  type MarcaNova,
} from "@/app/(app)/clientes/campo-cliente";
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
import { ConfirmTrocaEmpresaDialog } from "@/components/ui/confirm-troca-empresa-dialog";

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
  regionais: Pick<Regional, "id" | "nome" | "empresa_id">[];
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
  /** `cadastros.clientes.editar`. Sem ela, o campo Cliente não oferece
   *  cadastrar nem editar, e a Marca perde o "+" (18/09/2026). */
  podeCadastrarCliente?: boolean;
  podeEditarCliente?: boolean;
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
  podeCadastrarCliente = false,
  podeEditarCliente = false,
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
  const [dialogTrocaEmpresa, setDialogTrocaEmpresa] = React.useState(false);
  const [empresaPendente, setEmpresaPendente] = React.useState<string>("");
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

  const handleEmpresaChange = (nova: string) => {
    if (nova === empresaId) return;
    if (regionalIds.length > 0) {
      setEmpresaPendente(nova);
      setDialogTrocaEmpresa(true);
    } else {
      setEmpresaId(nova);
    }
  };

  const confirmarTrocaEmpresa = () => {
    setEmpresaId(empresaPendente);
    setRegionalIds([]);
  };

  /**
   * Cliente e marcas viram estado porque o cadastro rápido grava sem
   * recarregar a tela: o cliente criado no dialog precisa entrar na lista
   * e a marca que nasceu com ele precisa estar no campo Marca na mesma
   * hora (17/09/2026). `router.refresh()` resolveria — e zeraria o
   * formulário no meio do preenchimento.
   */
  const [clientesLocais, setClientesLocais] = React.useState<ClienteDoCampo[]>(
    () => clientes,
  );
  const [produtosLocais, setProdutosLocais] = React.useState<ProdutoOption[]>(
    () => produtos,
  );
  /** Ligado pelo "+" do campo Marca; o CampoCliente desliga ao abrir. */
  const [abrirMarcasDoCliente, setAbrirMarcasDoCliente] = React.useState(false);

  React.useEffect(() => setClientesLocais(clientes), [clientes]);
  React.useEffect(() => setProdutosLocais(produtos), [produtos]);

  function absorverCadastro(cliente: ClienteDoCampo, marcas: MarcaNova[]) {
    setClientesLocais((atual) =>
      atual.some((c) => c.id === cliente.id)
        ? atual.map((c) => (c.id === cliente.id ? { ...c, ...cliente } : c))
        : [...atual, cliente].sort((a, b) =>
            a.nome_fantasia.localeCompare(b.nome_fantasia, "pt-BR"),
          ),
    );
    setProdutosLocais((atual) => [
      ...atual.filter((p) => p.cliente_id !== cliente.id),
      ...marcas.map((m) => ({
        id: m.id,
        nome: m.nome,
        codigo: m.codigo,
        cliente_id: cliente.id,
      })),
    ]);
  }

  /** A marca criada pelo "+" ao lado do campo Marca. Entra na lista e fica
   *  escolhida — quem clicou ali queria usá-la agora. */
  const [marcaPendente, setMarcaPendente] = React.useState<string | null>(null);

  function absorverMarca(marca: { id: string; nome: string; codigo: string }) {
    if (!clienteId) return;
    setProdutosLocais((atual) => [
      ...atual,
      { ...marca, cliente_id: clienteId },
    ]);
    setMarcaPendente(marca.id);
  }

  // Produto é cadastrado por cliente: trocar de cliente invalida a escolha.
  const produtosDoCliente = React.useMemo(
    () => produtosLocais.filter((p) => p.cliente_id === clienteId),
    [produtosLocais, clienteId],
  );

  /** Escolher a marca nova é em DOIS tempos, de propósito: o `Select` do
   *  Radix descarta um `value` cuja `<SelectItem>` ainda não existe, e
   *  chama `onValueChange("")` em silêncio. Por isso a escolha espera a
   *  opção aparecer na lista, no render seguinte. */
  React.useEffect(() => {
    if (!marcaPendente) return;
    if (!produtosDoCliente.some((p) => p.id === marcaPendente)) return;
    setProdutoId(marcaPendente);
    setMarcaPendente(null);
  }, [marcaPendente, produtosDoCliente]);

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
          <Select value={empresaId} onValueChange={handleEmpresaChange}>
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

        {/* Combobox, não Select: são 157 clientes ativos e a lista rolada
            era o que mais custava tempo aqui. A busca ignora acento e
            olha também o código curto, que é o prefixo do número do
            projeto — quem lembra "AMBEV" acha pelo código. */}
        {/* Busca por nome ou código, e o botão ao lado cadastra (campo
            vazio) ou edita (cliente escolhido) sem sair do formulário —
            decisão 089, no molde do campo de fornecedor da PP. */}
        <Field label="Cliente" name="cliente_id" required errors={fieldErrors}>
          <CampoCliente
            value={clienteId || null}
            onChange={(v) => handleClienteChange(v ?? "")}
            clientes={clientesLocais}
            onCadastroMudou={absorverCadastro}
            podeCadastrar={podeCadastrarCliente}
            podeEditar={podeEditarCliente}
            className={erroClasses("cliente_id")}
            abrirMarcas={abrirMarcasDoCliente}
            onAbrirMarcasResolvido={() => setAbrirMarcasDoCliente(false)}
            onMarcaCriada={absorverMarca}
          />
        </Field>

        <Field label="Marca" name="produto_id" required errors={fieldErrors}>
          {/* O "+" ao lado abre um dialog de UMA marca — não a ficha do
              cliente, como abria até 18/09/2026. Ele aparece assim que há
              cliente escolhido, e não só quando a lista está vazia.

              Gate `podeCadastrarCliente` (`cadastros.clientes.inline`,
              Admin/GP/Produtor): a gravação é `adicionarMarcaAoCliente`,
              que só INSERE. Renomear e inativar marca continuam no
              cadastro do cliente, com o administrador — decisão 089 §6. */}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
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
            </div>
            {clienteId && podeCadastrarCliente && (
              <button
                type="button"
                onClick={() => setAbrirMarcasDoCliente(true)}
                title="Cadastrar marca deste cliente"
                aria-label="Cadastrar marca deste cliente"
                className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-border bg-white text-california-red transition-colors hover:border-california-red/40 hover:bg-california-red/[0.06]"
              >
                <Plus className="h-[17px] w-[17px]" />
              </button>
            )}
          </div>
          {clienteId && produtosDoCliente.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Este cliente ainda não tem marcas.{" "}
              {podeCadastrarCliente ? (
                <button
                  type="button"
                  onClick={() => setAbrirMarcasDoCliente(true)}
                  className="font-medium text-california-red hover:underline"
                >
                  Cadastrar agora
                </button>
              ) : (
                <span className="font-medium">
                  Peça a um administrador para cadastrar.
                </span>
              )}
            </p>
          )}
        </Field>

        <Field label="Regionais" name="regional_ids" required errors={fieldErrors}>
          <MultiSelect
            items={regionais
              .filter((r) => r.empresa_id === empresaId)
              .map((r) => ({ value: r.id, label: r.nome }))}
            value={regionalIds}
            onChange={setRegionalIds}
            placeholder={
              empresaId === ""
                ? "Escolha a empresa primeiro"
                : "Selecione uma ou mais regionais"
            }
            vazio={
              empresaId === ""
                ? "Escolha a empresa primeiro."
                : "Nenhuma regional ativa desta empresa."
            }
            disabled={empresaId === ""}
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
          {/* Obrigatória desde 03/09/2026 — era "Opcional" no handoff. */}
          <Field
            label="Descrição"
            name="descricao"
            required
            errors={fieldErrors}
          >
            <Textarea
              name="descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={DESCRICAO_MAX}
              rows={4}
              className={`min-h-[104px] resize-y leading-relaxed ${erroClasses(
                "descricao",
              )}`}
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

      <ConfirmTrocaEmpresaDialog
        open={dialogTrocaEmpresa}
        onOpenChange={setDialogTrocaEmpresa}
        onConfirm={confirmarTrocaEmpresa}
        contexto="regionais_aliadas"
      />
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
