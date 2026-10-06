"use server";

/**
 * A planilha de Mídia Off (decisão 147): as escritas da tela.
 *
 * A planilha grava célula a célula, como a nacional: cada Enter chega aqui
 * com o pedaço da linha que mudou. Meio novo, troca de meio, linha nova,
 * duplicar e a cópia de mês gravam por RPC (migrations 20261006500002 e
 * 20261006500003), numa transação só; aqui ficam a permissão, a trava da
 * versão e as frases de tela.
 *
 * Trava igual à da planilha nacional: `orcamentos.editar`, versão que não
 * está aprovada nem cancelada, e orçamento de Mídia Off.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { MEIOS } from "@/lib/midia/meios";
import type { CategoriaModeloPlanilha, FormaDeCompraMidia } from "@/lib/types";

export type ResultadoMidia =
  | { ok: true; id?: string }
  | { ok: false; message: string };

type Supabase = ReturnType<typeof createClient>;

interface Versao {
  versaoId: string;
  orcamentoId: string;
  projetoId: string;
}

/** A versão é de Mídia Off e aceita escrita? Devolve a frase da recusa. */
async function versaoEditavel(
  supabase: Supabase,
  tenantId: string,
  versaoId: string,
): Promise<{ ok: true; v: Versao } | { ok: false; message: string }> {
  const { data } = await supabase
    .from("versoes_orcamento")
    .select(
      "id, status, orcamento_id, " +
        // `!orcamento_id`: há duas FKs entre versão e orçamento (a da versão
        // aprovada volta). `!categoria_id`: o orçamento tem duas FKs para
        // `categorias_dominio`. Sem as dicas o embed é ambíguo (HTTP 300).
        "orcamento:orcamentos!orcamento_id!inner(projeto_id, status, arquivado_em, categoria:categorias_dominio!categoria_id(modelo_planilha))",
    )
    .eq("id", versaoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      status: string;
      orcamento_id: string;
      orcamento: {
        projeto_id: string;
        status: string;
        arquivado_em: string | null;
        categoria: { modelo_planilha: CategoriaModeloPlanilha } | null;
      };
    }>();
  if (!data) return { ok: false, message: "Versão não encontrada." };
  if (data.orcamento.categoria?.modelo_planilha !== "midia_off") {
    return { ok: false, message: "Esta versão não é de Mídia Off." };
  }
  if (data.status === "aprovada" || data.status === "cancelada") {
    return { ok: false, message: "Versão aprovada ou cancelada não aceita alteração nas linhas." };
  }
  if (["aprovado", "job_criado", "cancelado"].includes(data.orcamento.status)) {
    return { ok: false, message: "Orçamento aprovado, com job ou cancelado não aceita alteração nas linhas." };
  }
  if (data.orcamento.arquivado_em) {
    return { ok: false, message: "Orçamento arquivado é só leitura. Reative para editar." };
  }
  return {
    ok: true,
    v: { versaoId, orcamentoId: data.orcamento_id, projetoId: data.orcamento.projeto_id },
  };
}

function revalidar(v: Versao) {
  revalidatePath(`/orcamentos/${v.projetoId}/${v.orcamentoId}`);
}

/** As frases que as RPCs levantam já estão em português; o resto vira a
 *  mensagem padrão da ação. */
function mensagemDoBanco(error: { message: string; code?: string }, padrao: string): string {
  const m = error.message;
  if (m.includes("uniq_grupo_nome_por_mes")) {
    return "Este mês já tem este meio com este formato.";
  }
  if (m.includes("itens_periodo_em_ordem")) return "O fim precisa ser igual ou depois do início.";
  if (m.includes("row-level security") || m.includes("só leitura")) {
    return "Sem permissão para alterar esta versão.";
  }
  if (["P0002", "23514"].includes(error.code ?? "")) return m;
  return padrao;
}

// ---------------------------------------------------------------------------
// A linha
// ---------------------------------------------------------------------------

/** O que muda numa célula. Os nomes são os da planilha; a tradução para as
 *  colunas do banco mora em `colunasDoPatch`. */
export interface PatchDaLinha {
  praca?: string;
  veiculoId?: string | null;
  tipo?: "A" | "AR";
  descricao?: string;
  formato?: string;
  peca?: string;
  detalhe?: string;
  inicio?: string | null;
  fim?: string | null;
  qtde?: number;
  periodos?: number;
  unitTabela?: number;
  /** Fração: 0,6 = 60%. */
  desconto?: number;
  unitNegociado?: number;
  /** Grade: inserções por dia do mês. */
  dias?: Record<number, number>;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  return v.trim().slice(0, max);
}

function numero(v: unknown, { max, inteiro }: { max: number; inteiro?: boolean }): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return inteiro ? Math.round(n) : n;
}

/** Valida o patch e devolve as colunas. `null` = valor inválido. */
function colunasDoPatch(
  patch: PatchDaLinha,
  forma: FormaDeCompraMidia,
): { ok: true; colunas: Record<string, unknown> } | { ok: false; message: string } {
  const c: Record<string, unknown> = {};
  const recusa = (message: string) => ({ ok: false as const, message });

  if ("praca" in patch) c.praca = texto(patch.praca, 120) || null;
  if ("descricao" in patch) c.item = texto(patch.descricao, 500) ?? "";
  if ("formato" in patch) c.formato = texto(patch.formato, 200) || null;
  if ("peca" in patch) c.peca = texto(patch.peca, 20) || null;
  if ("detalhe" in patch) c.detalhe = texto(patch.detalhe, 500) || null;
  if ("tipo" in patch) {
    if (patch.tipo !== "A" && patch.tipo !== "AR") return recusa("Tipo inválido.");
    c.tipo_custo = patch.tipo;
  }
  if ("veiculoId" in patch) {
    if (patch.veiculoId !== null && typeof patch.veiculoId !== "string") {
      return recusa("Veículo inválido.");
    }
    c.fornecedor_id = patch.veiculoId;
  }
  if ("unitTabela" in patch) {
    const n = numero(patch.unitTabela, { max: 1e11 });
    if (n === null) return recusa("Valor de tabela inválido.");
    c.valor_unitario_tabela = Math.round(n * 10000) / 10000;
  }
  if ("desconto" in patch) {
    const n = numero(patch.desconto, { max: 1 });
    if (n === null) return recusa("O desconto vai de 0% a 100%.");
    c.percentual_desconto = Math.round(n * 100 * 10000) / 10000;
  }
  if ("unitNegociado" in patch) {
    const n = numero(patch.unitNegociado, { max: 1e11 });
    if (n === null) return recusa("Valor negociado inválido.");
    c.valor_unitario_orcado = Math.round(n * 100) / 100;
  }

  if (forma === "grade") {
    if ("dias" in patch) {
      const dias: Record<string, number> = {};
      for (const [k, v] of Object.entries(patch.dias ?? {})) {
        const dia = Number(k);
        const n = numero(v, { max: 9999, inteiro: true });
        if (!Number.isInteger(dia) || dia < 1 || dia > 31 || n === null) {
          return recusa("Inserções inválidas.");
        }
        if (n > 0) dias[String(dia)] = n;
      }
      // A quantidade orçada é a soma, pelo banco (`midia_quantidade_da_grade`).
      c.insercoes_por_dia = dias;
    }
    for (const campo of ["inicio", "fim", "qtde", "periodos"] as const) {
      if (campo in patch) return recusa("Este campo é das linhas por período.");
    }
  } else {
    if ("dias" in patch) return recusa("As inserções por dia são da grade de TV e rádio.");
    for (const campo of ["inicio", "fim"] as const) {
      if (campo in patch) {
        const v = patch[campo];
        if (v !== null && (typeof v !== "string" || !DATA_ISO.test(v))) {
          return recusa("Data inválida.");
        }
        c[campo === "inicio" ? "data_inicio" : "data_fim"] = v;
      }
    }
    if ("qtde" in patch) {
      const n = numero(patch.qtde, { max: 1e8 });
      if (n === null) return recusa("Quantidade inválida.");
      c.quantidade_orcada = n;
    }
    if ("periodos" in patch) {
      const n = numero(patch.periodos, { max: 1e6 });
      if (n === null) return recusa("Número de períodos inválido.");
      c.dias_meses_orcado = n;
    }
  }
  return { ok: true, colunas: c };
}

/** Grava o que mudou numa linha — a escrita de maior frequência da tela. */
export async function atualizarLinhaMidia(
  itemId: string,
  patch: PatchDaLinha,
): Promise<ResultadoMidia> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const { data: item } = await supabase
    .from("versoes_orcamento_itens")
    .select(
      "id, versao_orcamento_id, data_inicio, data_fim, " +
        "grupo:versoes_orcamento_grupos!inner(forma_compra, mes_id)",
    )
    .eq("id", itemId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      versao_orcamento_id: string;
      data_inicio: string | null;
      data_fim: string | null;
      grupo: { forma_compra: FormaDeCompraMidia | null; mes_id: string | null };
    }>();
  if (!item) return { ok: false, message: "Linha não encontrada." };
  if (!item.grupo.forma_compra) return { ok: false, message: "Esta linha não é de mídia." };

  const edit = await versaoEditavel(supabase, tenantId, item.versao_orcamento_id);
  if (!edit.ok) return edit;

  const montado = colunasDoPatch(patch, item.grupo.forma_compra);
  if (!montado.ok) return montado;
  const colunas = montado.colunas;
  if (Object.keys(colunas).length === 0) return { ok: true, id: itemId };

  // O veículo sai do cadastro de veículos.
  if (typeof colunas.fornecedor_id === "string") {
    const { data: veiculo } = await supabase
      .from("veiculos_midia")
      .select("id")
      .eq("fornecedor_id", colunas.fornecedor_id)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string }>();
    if (!veiculo) return { ok: false, message: "Escolha um veículo do cadastro de veículos." };
  }

  // A linha por período mora no mês dela: o início fica nesse mês.
  if (typeof colunas.data_inicio === "string" && item.grupo.mes_id) {
    const { data: mes } = await supabase
      .from("versoes_orcamento_meses")
      .select("mes")
      .eq("id", item.grupo.mes_id)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ mes: string }>();
    if (mes && colunas.data_inicio.slice(0, 7) !== mes.mes.slice(0, 7)) {
      return { ok: false, message: "O início fica no mês da linha." };
    }
  }
  const inicio = "data_inicio" in colunas ? (colunas.data_inicio as string | null) : item.data_inicio;
  const fim = "data_fim" in colunas ? (colunas.data_fim as string | null) : item.data_fim;
  if (inicio && fim && fim < inicio) {
    return { ok: false, message: "O fim precisa ser igual ou depois do início." };
  }

  const { error } = await supabase
    .from("versoes_orcamento_itens")
    .update(colunas)
    .eq("id", itemId)
    .eq("tenant_id", tenantId);
  if (error) {
    console.error("[midia.linha]", error.message);
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível salvar a alteração.") };
  }
  revalidar(edit.v);
  return { ok: true, id: itemId };
}

/** As inserções de várias linhas de uma vez: arrastar sobre os dias e
 *  digitar o número. Só linhas da grade desta versão. */
export async function gravarInsercoesMidia(
  versaoId: string,
  linhas: Array<{ id: string; dias: Record<number, number> }>,
): Promise<ResultadoMidia> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const tenantId = session.activeTenant.id;
  const supabase = createClient();
  if (!Array.isArray(linhas) || linhas.length === 0 || linhas.length > 500) {
    return { ok: false, message: "Nada para gravar." };
  }
  const edit = await versaoEditavel(supabase, tenantId, versaoId);
  if (!edit.ok) return edit;

  const payload: Array<{ id: string; insercoes: Record<string, number> }> = [];
  for (const l of linhas) {
    const montado = colunasDoPatch({ dias: l.dias }, "grade");
    if (!montado.ok) return montado;
    payload.push({ id: String(l.id), insercoes: montado.colunas.insercoes_por_dia as Record<string, number> });
  }

  const { error } = await supabase.rpc("midia_gravar_insercoes", {
    p_versao_id: versaoId,
    p_linhas: payload,
  });
  if (error) {
    console.error("[midia.insercoes]", error.message);
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível gravar as inserções.") };
  }
  revalidar(edit.v);
  return { ok: true };
}

async function grupoDaVersao(
  supabase: Supabase,
  tenantId: string,
  grupoId: string,
): Promise<{ versao_orcamento_id: string; meio: string | null; mes_id: string | null } | null> {
  const { data } = await supabase
    .from("versoes_orcamento_grupos")
    .select("versao_orcamento_id, meio, mes_id")
    .eq("id", grupoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ versao_orcamento_id: string; meio: string | null; mes_id: string | null }>();
  return data ?? null;
}

/** "+ Nova linha" de um meio: em branco, no fim dele, com a praça da de cima. */
export async function novaLinhaMidia(grupoId: string): Promise<ResultadoMidia> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const tenantId = session.activeTenant.id;
  const supabase = createClient();
  const grupo = await grupoDaVersao(supabase, tenantId, grupoId);
  if (!grupo?.meio) return { ok: false, message: "Meio não encontrado." };
  const edit = await versaoEditavel(supabase, tenantId, grupo.versao_orcamento_id);
  if (!edit.ok) return edit;

  const { data, error } = await supabase.rpc("midia_nova_linha", { p_grupo_id: grupoId });
  if (error) {
    console.error("[midia.nova_linha]", error.message);
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível criar a linha.") };
  }
  revalidar(edit.v);
  return { ok: true, id: String(data) };
}

/** A cópia entra logo abaixo da original. */
export async function duplicarLinhaMidia(itemId: string): Promise<ResultadoMidia> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const tenantId = session.activeTenant.id;
  const supabase = createClient();
  const { data: item } = await supabase
    .from("versoes_orcamento_itens")
    .select("versao_orcamento_id")
    .eq("id", itemId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ versao_orcamento_id: string }>();
  if (!item) return { ok: false, message: "Linha não encontrada." };
  const edit = await versaoEditavel(supabase, tenantId, item.versao_orcamento_id);
  if (!edit.ok) return edit;

  const { data, error } = await supabase.rpc("midia_duplicar_linha", { p_item_id: itemId });
  if (error) {
    console.error("[midia.duplicar]", error.message);
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível duplicar a linha.") };
  }
  revalidar(edit.v);
  return { ok: true, id: String(data) };
}

export async function removerLinhaMidia(itemId: string): Promise<ResultadoMidia> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const tenantId = session.activeTenant.id;
  const supabase = createClient();
  const { data: item } = await supabase
    .from("versoes_orcamento_itens")
    .select("versao_orcamento_id")
    .eq("id", itemId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ versao_orcamento_id: string }>();
  if (!item) return { ok: false, message: "Linha não encontrada." };
  const edit = await versaoEditavel(supabase, tenantId, item.versao_orcamento_id);
  if (!edit.ok) return edit;

  const { error } = await supabase
    .from("versoes_orcamento_itens")
    .delete()
    .eq("id", itemId)
    .eq("tenant_id", tenantId);
  if (error) {
    console.error("[midia.remover_linha]", error.message);
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível remover a linha.") };
  }
  revalidar(edit.v);
  return { ok: true, id: itemId };
}

// ---------------------------------------------------------------------------
// O meio
// ---------------------------------------------------------------------------

function meioValido(meio: string): { nome: string; forma: FormaDeCompraMidia } | null {
  return MEIOS.find((m) => m.nome === meio) ?? null;
}

function formatoLimpo(formato: string | null | undefined): string {
  return (formato ?? "").trim().slice(0, 200) || "—";
}

const igual = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** Meio + formato identificam o meio na versão: o meio novo (ou editado)
 *  não pode repetir outro. `ignorar` é o meio que está sendo editado. */
async function meioRepetido(
  supabase: Supabase,
  tenantId: string,
  versaoId: string,
  meio: string,
  formato: string,
  ignorar?: { meio: string; formato: string },
): Promise<string | null> {
  const { data } = await supabase
    .from("versoes_orcamento_grupos")
    .select("meio, formato")
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", tenantId)
    .not("meio", "is", null)
    .returns<Array<{ meio: string; formato: string | null }>>();
  const outro = (data ?? []).find(
    (g) =>
      igual(g.meio, meio) &&
      igual(g.formato ?? "—", formato) &&
      !(ignorar && igual(g.meio, ignorar.meio) && igual(g.formato ?? "—", ignorar.formato)),
  );
  return outro
    ? `Já existe ${meio} · ${outro.formato ?? "—"} nesta versão: use o meio que já existe.`
    : null;
}

/** "Novo meio" num mês: o meio que já existe no mês com o mesmo formato
 *  ganha uma linha; senão nasce, com uma linha em branco. */
export async function criarMeioMidia(
  versaoId: string,
  mesId: string,
  meio: string,
  formato: string,
): Promise<ResultadoMidia> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const tenantId = session.activeTenant.id;
  const supabase = createClient();
  const escolhido = meioValido(meio);
  if (!escolhido) return { ok: false, message: "Escolha o meio na lista." };
  const edit = await versaoEditavel(supabase, tenantId, versaoId);
  if (!edit.ok) return edit;

  const { data, error } = await supabase.rpc("midia_criar_meio", {
    p_versao_id: versaoId,
    p_mes_id: mesId,
    p_meio: escolhido.nome,
    p_forma: escolhido.forma,
    p_formato: formatoLimpo(formato),
  });
  if (error) {
    console.error("[midia.criar_meio]", error.message);
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível criar o meio.") };
  }
  revalidar(edit.v);
  return { ok: true, id: String(data) };
}

/**
 * O lápis do título do meio: vale para o meio em TODOS os meses. Só o
 * formato muda → as linhas com o formato antigo acompanham. Outro meio → as
 * linhas do meio são apagadas e cada mês fica com uma linha em branco (a
 * tela pergunta antes, "Trocar o meio?").
 */
export async function editarMeioMidia(
  versaoId: string,
  atual: { meio: string; formato: string },
  novo: { meio: string; formato: string },
): Promise<ResultadoMidia> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const tenantId = session.activeTenant.id;
  const supabase = createClient();
  const escolhido = meioValido(novo.meio);
  if (!escolhido) return { ok: false, message: "Escolha o meio na lista." };
  const edit = await versaoEditavel(supabase, tenantId, versaoId);
  if (!edit.ok) return edit;

  const formatoNovo = formatoLimpo(novo.formato);
  if (igual(atual.meio, escolhido.nome) && igual(atual.formato, formatoNovo)) {
    return { ok: true };
  }
  const repetido = await meioRepetido(supabase, tenantId, versaoId, escolhido.nome, formatoNovo, atual);
  if (repetido) return { ok: false, message: repetido };

  const { data: apagadas, error } = await supabase.rpc("midia_editar_meio", {
    p_versao_id: versaoId,
    p_meio: atual.meio,
    p_formato: formatoLimpo(atual.formato),
    p_meio_novo: escolhido.nome,
    p_forma_nova: escolhido.forma,
    p_formato_novo: formatoNovo,
  });
  if (error) {
    console.error("[midia.editar_meio]", error.message);
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível salvar o meio.") };
  }

  await logAuditEvent({
    acao: "versao_orcamento.midia_meio_editado",
    tenantId,
    entidadeTipo: "versao_orcamento",
    entidadeId: versaoId,
    metadata: {
      de: atual,
      para: { meio: escolhido.nome, formato: formatoNovo },
      linhas_apagadas: Number(apagadas ?? 0),
    },
  });
  revalidar(edit.v);
  return { ok: true };
}

/** A lixeira do meio no mês: o meio sai deste mês, com as linhas dele. */
export async function removerMeioDoMesMidia(grupoId: string): Promise<ResultadoMidia> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;
  const tenantId = session.activeTenant.id;
  const supabase = createClient();
  const grupo = await grupoDaVersao(supabase, tenantId, grupoId);
  if (!grupo?.meio) return { ok: false, message: "Meio não encontrado." };
  const edit = await versaoEditavel(supabase, tenantId, grupo.versao_orcamento_id);
  if (!edit.ok) return edit;

  const { count } = await supabase
    .from("versoes_orcamento_itens")
    .select("id", { count: "exact", head: true })
    .eq("grupo_id", grupoId)
    .eq("tenant_id", tenantId);

  const { error } = await supabase.rpc("deletar_grupo_orcamento", { p_grupo_id: grupoId });
  if (error) {
    console.error("[midia.remover_meio]", error.message);
    return { ok: false, message: mensagemDoBanco(error, "Não foi possível remover o meio.") };
  }
  await logAuditEvent({
    acao: "versao_orcamento.midia_meio_removido",
    tenantId,
    entidadeTipo: "versao_orcamento",
    entidadeId: grupo.versao_orcamento_id,
    metadata: { grupo_id: grupoId, meio: grupo.meio, mes_id: grupo.mes_id, linhas_apagadas: count ?? 0 },
  });
  revalidar(edit.v);
  return { ok: true };
}
