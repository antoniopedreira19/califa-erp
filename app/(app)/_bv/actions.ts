"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { bvSchema } from "@/lib/validations/bv";
import type { BvSituacao, ChaveItemBv, ItemBv, JobStatus } from "@/lib/types";
import { jobEstaCongelado, jobAceitaAcoesPlanilha } from "@/lib/types";
import { aceitaBV } from "@/lib/calculos/versao-totais";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * De qual tela veio a chamada. Muda uma única regra — a de versão
 * congelada — mas ela é decisiva:
 *
 * - `orcamento`: a versão precisa estar aberta. Aprovada ou cancelada, a
 *   grade inteira é read-only e o BV acompanha.
 * - `job`: a versão é **necessariamente** a aprovada, que é justamente o
 *   estado que o orçamento bloqueia. Depois da aprovação a planilha do
 *   job passa a ser o lugar de mexer no BV.
 */
export type OrigemBv = "orcamento" | "job";

/** Tipos de custo em que o cliente paga o fornecedor diretamente — os
 *  únicos em que existe comissão a negociar. B e C passam pela
 *  California e usam Pedido de Produção no lugar do BV. */

interface ContextoItem {
  versao_orcamento_id: string;
  orcamento_id: string;
  projeto_id: string;
  job_id: string | null;
  /** A cópia deste item na planilha do job. É por ela que a planilha do
   *  job lê o BV desde 27/08/2026 — `null` enquanto o job não existe. */
  job_item_orcado_id: string | null;
  /** O item na versão aprovada. `null` na linha nascida de errata, que
   *  não tem correspondente lá (decisão 073). */
  item_versao_id: string | null;
  item: string;
}

/**
 * O id não é de item de versão. Antes de dizer "Item não encontrado." —
 * que mandava investigar o lugar errado — vale uma consulta: o id quase
 * sempre é o da CÓPIA do job, e os dois motivos possíveis pedem respostas
 * diferentes (decisão 071).
 */
async function porQueNaoAchou(
  id: string,
  tenantId: string,
): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase
    .from("jobs_itens_orcado")
    .select("item_versao_id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ item_versao_id: string | null }>();

  if (!data) return "Item não encontrado.";
  // A linha existe no job e nasceu de errata. Desde a decisão 073 ela
  // ACEITA BV — mas por `job_item_orcado_id`, e quem chegou aqui mandou
  // a chave da versão. É tela velha, não regra de negócio.
  if (!data.item_versao_id) {
    return "A tela está desatualizada — recarregue a página e lance o BV de novo.";
  }
  // A linha tem item de versão, mas quem chamou mandou o id da cópia: é
  // uma tela desatualizada, do jeito que a planilha do job fazia até
  // 11/09/2026.
  return "A tela está desatualizada — recarregue a página e lance o BV de novo.";
}

/** As travas que dependem do ESTADO DO JOB. Valem igual venha o item da
 *  versão ou da cópia, então moram num lugar só. */
function barreiraDoJob(status: JobStatus): string | null {
  // Job encerrado é histórico: nem lançar, nem confirmar, nem cancelar
  // BV. As três ações passam por aqui.
  if (jobEstaCongelado(status)) {
    return "Job encerrado — o BV não pode mais ser alterado.";
  }
  // Pré-abertura: o job existe (a cópia nasce no envio para abertura),
  // mas o financeiro ainda não o abriu. A planilha do job é visível nesse
  // estado e o realizado é editável nele — o BV não: é compromisso de
  // comissão, e o job ainda pode voltar.
  if (!jobAceitaAcoesPlanilha(status)) {
    return status === "rejeitado_financeiro"
      ? "Job devolvido pelo financeiro — o BV fica disponível depois da abertura."
      : "Job aguardando abertura pelo financeiro — o BV fica disponível depois da abertura.";
  }
  return null;
}

const ERRO_TIPO_SEM_BV =
  "BV só pode ser lançado em item de custo tipo A, A · Repasse ou D.";

/**
 * Carrega o item e barra tudo que torna o BV inválido: tenant errado,
 * tipo de custo sem BV, linha em save, job congelado e versão congelada
 * para a origem da chamada.
 *
 * Aceita as DUAS chaves (decisão 073). A linha que existe no orçamento
 * aprovado entra por `versao` — o caminho de sempre. A que só existe na
 * planilha do job, nascida de errata, entra por `job`, e aí a cópia é a
 * única fonte de tipo, tenant e save que existe.
 */
async function carregarContexto(
  chave: ChaveItemBv,
  tenantId: string,
  origem: OrigemBv,
): Promise<ContextoItem | { error: string }> {
  return chave.espaco === "versao"
    ? contextoPelaVersao(chave.id, tenantId, origem)
    : contextoPelaCopiaDoJob(chave.id, tenantId, origem);
}

/** Caminho histórico: o item vive na versão do orçamento. */
async function contextoPelaVersao(
  itemVersaoId: string,
  tenantId: string,
  origem: OrigemBv,
): Promise<ContextoItem | { error: string }> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("versoes_orcamento_itens")
    .select(
      "item, tipo_custo, versao_orcamento_id, versao:versoes_orcamento!inner(orcamento_id, status)",
    )
    .eq("id", itemVersaoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      item: string;
      tipo_custo: string;
      versao_orcamento_id: string;
      versao: { orcamento_id: string; status: string };
    }>();

  if (error) {
    console.error("[bv.contexto]", error.message);
    return { error: "Não foi possível carregar o item." };
  }
  if (!data?.versao) {
    return { error: await porQueNaoAchou(itemVersaoId, tenantId) };
  }

  // Versão cancelada não aceita BV de lugar nenhum. Aprovada só bloqueia
  // o orçamento — é o estado normal de trabalho do job.
  if (data.versao.status === "cancelada") {
    return { error: "Versão cancelada não permite alterar o BV." };
  }
  if (origem === "orcamento" && data.versao.status === "aprovada") {
    return {
      error:
        "Versão aprovada — o BV passa a ser tratado na planilha do job.",
    };
  }

  // As duas rotas são revalidadas em toda escrita: o mesmo BV aparece na
  // versão e na planilha do job, e sair de uma tela para a outra não pode
  // mostrar valor velho de cache. A cópia do job entrega, de quebra, o
  // tipo que a errata deixou lá.
  const [orcRes, copiaRes] = await Promise.all([
    supabase
      .from("orcamentos")
      .select("projeto_id")
      .eq("id", data.versao.orcamento_id)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ projeto_id: string }>(),
    supabase
      .from("jobs_itens_orcado")
      .select("id, job_id, tipo_custo, job:jobs!inner(status)")
      .eq("item_versao_id", itemVersaoId)
      .eq("tenant_id", tenantId)
      .neq("job.status", "cancelado")
      .maybeSingle<{
        id: string;
        job_id: string;
        tipo_custo: string;
        job: { status: string };
      }>(),
  ]);

  if (copiaRes.data) {
    const barreira = barreiraDoJob(copiaRes.data.job.status as JobStatus);
    if (barreira) return { error: barreira };
  }

  // Depois da abertura do job quem manda é a cópia: a errata pode ter
  // mudado o tipo lá, e a versão aprovada não acompanha de propósito.
  // Mesma regra do trigger `bv_exige_item_com_bv`.
  const tipoEfetivo = copiaRes.data?.tipo_custo ?? data.tipo_custo;
  if (!aceitaBV(tipoEfetivo)) {
    return { error: ERRO_TIPO_SEM_BV };
  }

  return {
    versao_orcamento_id: data.versao_orcamento_id,
    orcamento_id: data.versao.orcamento_id,
    projeto_id: orcRes.data?.projeto_id ?? "",
    job_id: copiaRes.data?.job_id ?? null,
    job_item_orcado_id: copiaRes.data?.id ?? null,
    item_versao_id: itemVersaoId,
    item: data.item,
  };
}

/**
 * Caminho da decisão 073: o endereço é a linha da planilha do job.
 *
 * É por aqui que a linha nascida de errata passa — ela não tem item na
 * versão aprovada, e a cópia responde por tudo. Uma linha que TEM item na
 * versão também pode entrar por aqui sem estrago: o `item_versao_id` dela
 * volta no contexto e a gravação preenche as duas chaves, como sempre.
 */
async function contextoPelaCopiaDoJob(
  jobItemOrcadoId: string,
  tenantId: string,
  origem: OrigemBv,
): Promise<ContextoItem | { error: string }> {
  // A tela de Orçamentos não conhece a planilha do job, e a linha de
  // errata não existe lá. Se veio de lá com esta chave, é chamada
  // forjada — a trava não pode depender de o botão estar escondido.
  if (origem === "orcamento") {
    return {
      error: "Esta linha só existe na planilha do job — lance o BV por lá.",
    };
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from("jobs_itens_orcado")
    .select(
      "id, item, tipo_custo, em_save, item_versao_id, job_id, job:jobs!inner(status, projeto_id, orcamento_id, versao_orcamento_aprovada_id)",
    )
    .eq("id", jobItemOrcadoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      item: string;
      tipo_custo: string;
      em_save: boolean | null;
      item_versao_id: string | null;
      job_id: string;
      job: {
        status: string;
        projeto_id: string;
        orcamento_id: string;
        versao_orcamento_aprovada_id: string | null;
      };
    }>();

  if (error) {
    console.error("[bv.contexto.job]", error.message);
    return { error: "Não foi possível carregar o item." };
  }
  if (!data?.job) return { error: "Item não encontrado." };

  if (data.job.status === "cancelado") {
    return { error: "Job cancelado — o BV não pode ser alterado." };
  }
  const barreira = barreiraDoJob(data.job.status as JobStatus);
  if (barreira) return { error: barreira };

  // Linha em save: o serviço não acontece neste projeto, então não há
  // fornecedor com quem negociar comissão (decisão 028 §9). No caminho da
  // versão quem recusa é o trigger; aqui a checagem é direta porque a
  // cópia já traz o campo.
  if (data.em_save) {
    return {
      error:
        "Linha em save não aceita BV: o serviço não acontece neste projeto.",
    };
  }

  if (!aceitaBV(data.tipo_custo)) {
    return { error: ERRO_TIPO_SEM_BV };
  }

  return {
    versao_orcamento_id: data.job.versao_orcamento_aprovada_id ?? "",
    orcamento_id: data.job.orcamento_id,
    projeto_id: data.job.projeto_id,
    job_id: data.job_id,
    job_item_orcado_id: data.id,
    item_versao_id: data.item_versao_id,
    item: data.item,
  };
}

function revalidarAmbas(ctx: ContextoItem) {
  // A planilha da versão passou a morar na tela do orçamento (as versões
  // viraram abas em 21/08/2026): é esse o caminho a revalidar.
  revalidatePath(`/orcamentos/${ctx.projeto_id}/${ctx.orcamento_id}`);
  if (ctx.job_id) revalidatePath(`/jobs/${ctx.job_id}`);
}

/**
 * A partir de `confirmado` o BV foi enviado ao financeiro e, em
 * `recebido`, já teve baixa no contas a receber. Daí em diante ninguém
 * altera — nem pelo orçamento, nem pelo job.
 */
function bvTravado(situacao: BvSituacao): boolean {
  return situacao === "confirmado" || situacao === "recebido";
}

/**
 * De onde o BV pendura: a chave que ele gravou. Desde a decisão 073 são
 * duas possibilidades, e `confirmarBv`/`cancelarBv` chegam pelo id do BV,
 * não pelo do item — então a chave precisa ser derivada dele.
 */
function chaveDoBv(bv: {
  item_versao_id: string | null;
  job_item_orcado_id: string | null;
}): ChaveItemBv | null {
  if (bv.item_versao_id) return { espaco: "versao", id: bv.item_versao_id };
  if (bv.job_item_orcado_id) return { espaco: "job", id: bv.job_item_orcado_id };
  return null;
}

function mensagemTravado(situacao: BvSituacao): string {
  return situacao === "recebido"
    ? "BV já recebido — não pode mais ser alterado."
    : "BV já confirmado e enviado ao financeiro — não pode mais ser alterado.";
}

function extractBvInput(formData: FormData) {
  const texto = (k: string) => formData.get(k)?.toString().trim() ?? "";
  return {
    fornecedor_id: texto("fornecedor_id"),
    valor: texto("valor"),
    prazo_repasse: texto("prazo_repasse"),
    percentual_imposto: texto("percentual_imposto"),
  };
}

/**
 * Lança um BV novo no item, ou atualiza um que já existe.
 *
 * **É `bvId` que decide qual dos dois.** Até 08/09/2026 um item tinha no
 * máximo um BV (`uniq_bv_item`) e isto era um upsert pela chave do item;
 * a decisão 062 soltou a restrição, e agora o item tem uma LISTA — o
 * mesmo desenho das PPs. Sem `bvId`, nasce um BV novo.
 *
 * A `situacao` nunca vem do formulário: todo BV nasce em `a_negociar`, e
 * quem o move para `confirmado` é `confirmarBv`.
 */
export async function salvarBv(
  chave: ChaveItemBv,
  formData: FormData,
  origem: OrigemBv = "orcamento",
  /** BV a atualizar. Ausente ⇒ lança um BV novo na linha. */
  bvId?: string | null,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;

  const parsed = bvSchema.safeParse(extractBvInput(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.errors[0]?.message ?? "Verifique os campos.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const ctx = await carregarContexto(chave, session.activeTenant.id, origem);
  if ("error" in ctx) return { ok: false, message: ctx.error };

  const supabase = createClient();

  // Por qual coluna este item endereça os BVs dele. A linha da versão
  // segue pela chave da versão — é onde os BVs antigos estão, inclusive
  // os de antes de a cópia existir. Só a linha de errata usa a do job.
  const colunaDoItem = ctx.item_versao_id
    ? ("item_versao_id" as const)
    : ("job_item_orcado_id" as const);
  const valorDoItem = ctx.item_versao_id ?? ctx.job_item_orcado_id!;

  // Editando um BV específico: ele precisa existir, ser deste item e
  // ainda estar aberto. Sem o filtro pelo item um id de outra linha
  // passaria — a chave do BV é o id dele, mas quem autoriza é o item que
  // o contexto validou.
  let existente: Pick<ItemBv, "id" | "situacao"> | null = null;
  if (bvId) {
    const { data } = await supabase
      .from("itens_bv")
      .select("id, situacao")
      .eq("id", bvId)
      .eq(colunaDoItem, valorDoItem)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<Pick<ItemBv, "id" | "situacao">>();
    if (!data) return { ok: false, message: "BV não encontrado." };
    if (bvTravado(data.situacao)) {
      return { ok: false, message: mensagemTravado(data.situacao) };
    }
    if (data.situacao === "cancelado") {
      return { ok: false, message: "BV cancelado — lance um BV novo." };
    }
    existente = data;
  }

  const ativo = existente !== null;

  const payload = {
    tenant_id: session.activeTenant.id,
    // As duas chaves, cada uma quando existe. A da versão falta na linha
    // nascida de errata (decisão 073); a do job falta enquanto o job não
    // nasceu. `chk_bv_tem_item` garante no banco que pelo menos uma vem.
    ...(ctx.item_versao_id ? { item_versao_id: ctx.item_versao_id } : {}),
    // A planilha do job lê o BV por esta chave. Gravar aqui é o que
    // impede o BV lançado no orçamento de sumir depois que o job nasce.
    ...(ctx.job_item_orcado_id
      ? { job_item_orcado_id: ctx.job_item_orcado_id }
      : {}),
    fornecedor_id: parsed.data.fornecedor_id,
    valor: parsed.data.valor,
    prazo_repasse: parsed.data.prazo_repasse,
    // Pode ficar nula enquanto se negocia. `confirmarBv` é quem cobra
    // (decisão 062).
    percentual_imposto: parsed.data.percentual_imposto,
    // BV novo nasce em `a_negociar`. Editar não move a situação.
    ...(ativo ? {} : { situacao: "a_negociar" as const }),
  };

  const { data: salvo, error } = existente
    ? await supabase
        .from("itens_bv")
        .update(payload)
        .eq("id", existente.id)
        .eq("tenant_id", session.activeTenant.id)
        .select("id")
        .maybeSingle<Pick<ItemBv, "id">>()
    : await supabase
        .from("itens_bv")
        .insert({ ...payload, created_by: session.profile.id })
        .select("id")
        .maybeSingle<Pick<ItemBv, "id">>();

  if (error) {
    console.error("[bv.salvar]", error.message);
    // O trigger `trg_itens_bv_tipo_com_bv` fala português: se ele barrou,
    // a mensagem dele é mais útil que um genérico.
    if (error.message.includes("tipo A")) {
      return {
        ok: false,
        message:
          "BV só pode ser lançado em item de custo tipo A, A · Repasse ou D.",
      };
    }
    return { ok: false, message: "Não foi possível salvar o BV." };
  }

  await logAuditEvent({
    acao: ativo ? "item_bv.editado" : "item_bv.lancado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "item_bv",
    entidadeId: salvo?.id ?? null,
    metadata: {
      item_versao_id: ctx.item_versao_id,
      job_item_orcado_id: ctx.job_item_orcado_id,
      item: ctx.item,
      valor: parsed.data.valor,
      fornecedor_id: parsed.data.fornecedor_id,
      percentual_imposto: parsed.data.percentual_imposto,
      origem,
    },
  });

  revalidarAmbas(ctx);
  return { ok: true, id: salvo?.id };
}

/**
 * Confirma UM BV e o envia ao financeiro: `a_negociar` → `confirmado`.
 * A partir daqui esse BV fica travado nas duas telas — os outros BVs do
 * mesmo item seguem editáveis (decisão 062: cada um anda sozinho).
 *
 * Só existe a partir da planilha do job — é lá que o BV é fechado, com o
 * fornecedor já definido.
 *
 * DUAS EXIGÊNCIAS, e as duas são sobre virar cobrança:
 * - `fornecedor_id` — quem devolve o valor precisa ter nome;
 * - `percentual_imposto` — a alíquota do BV, que só passa a ser
 *   obrigatória aqui (decisão 062). Ela não alimenta a planilha, que
 *   desconta o bruto; ela é o que o contas a receber precisa saber.
 */
export async function confirmarBv(bvId: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;

  const supabase = createClient();

  // O BV é a chave agora, então o item vem DELE — e o contexto (tenant,
  // tipo de custo, job congelado) é validado a partir do item, como
  // sempre foi.
  const { data: atual } = await supabase
    .from("itens_bv")
    .select(
      "id, valor, situacao, fornecedor_id, percentual_imposto, item_versao_id, job_item_orcado_id",
    )
    .eq("id", bvId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<
      Pick<
        ItemBv,
        | "id"
        | "valor"
        | "situacao"
        | "fornecedor_id"
        | "percentual_imposto"
        | "item_versao_id"
        | "job_item_orcado_id"
      >
    >();

  const chave = atual ? chaveDoBv(atual) : null;
  if (!atual || atual.situacao === "cancelado" || !chave) {
    return { ok: false, message: "BV não encontrado." };
  }

  const ctx = await carregarContexto(chave, session.activeTenant.id, "job");
  if ("error" in ctx) return { ok: false, message: ctx.error };

  if (bvTravado(atual.situacao)) {
    return { ok: false, message: mensagemTravado(atual.situacao) };
  }
  if (!atual.fornecedor_id) {
    return {
      ok: false,
      message: "Informe o fornecedor antes de confirmar o BV.",
    };
  }
  if (atual.percentual_imposto === null || atual.percentual_imposto === undefined) {
    return {
      ok: false,
      message:
        "Informe a alíquota do imposto antes de enviar o BV ao contas a receber.",
    };
  }

  const { error } = await supabase
    .from("itens_bv")
    .update({ situacao: "confirmado" })
    .eq("id", atual.id)
    .eq("tenant_id", session.activeTenant.id)
    .eq("situacao", "a_negociar");

  if (error) {
    console.error("[bv.confirmar]", error.message);
    return { ok: false, message: "Não foi possível confirmar o BV." };
  }

  await logAuditEvent({
    acao: "item_bv.confirmado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "item_bv",
    entidadeId: atual.id,
    metadata: {
      item_versao_id: ctx.item_versao_id,
      job_item_orcado_id: ctx.job_item_orcado_id,
      item: ctx.item,
      valor: atual.valor,
      fornecedor_id: atual.fornecedor_id,
      job_id: ctx.job_id,
    },
  });

  revalidarAmbas(ctx);
  return { ok: true, id: atual.id };
}

/**
 * "Remover BV" na tela é um CANCELAMENTO: a linha não é apagada, a
 * situação vira `cancelado`. O BV cancelado some da lista do item (as
 * páginas só carregam os ativos).
 *
 * Por BV desde 08/09/2026 (decisão 062): cancelar um não toca nos outros
 * BVs da mesma linha.
 */
export async function cancelarBv(
  bvId: string,
  origem: OrigemBv = "orcamento",
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar");
  if (!gate.ok) return gate;

  const supabase = createClient();

  const { data: atual } = await supabase
    .from("itens_bv")
    .select("id, situacao, item_versao_id, job_item_orcado_id")
    .eq("id", bvId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<
      Pick<
        ItemBv,
        "id" | "situacao" | "item_versao_id" | "job_item_orcado_id"
      >
    >();

  const chave = atual ? chaveDoBv(atual) : null;
  if (!atual || !chave) {
    return { ok: false, message: "BV não encontrado." };
  }
  if (bvTravado(atual.situacao)) {
    return { ok: false, message: mensagemTravado(atual.situacao) };
  }

  const ctx = await carregarContexto(chave, session.activeTenant.id, origem);
  if ("error" in ctx) return { ok: false, message: ctx.error };

  const { data: cancelado, error } = await supabase
    .from("itens_bv")
    .update({ situacao: "cancelado" })
    // Pelo ID, não pela linha: um item tem vários BVs desde 08/09/2026, e
    // filtrar por `item_versao_id` cancelaria todos de uma vez.
    .eq("id", atual.id)
    .eq("tenant_id", session.activeTenant.id)
    // Cancelar o que já está cancelado não é operação: sem isto, um
    // duplo clique gravaria um segundo evento de auditoria idêntico.
    .eq("situacao", "a_negociar")
    .select("id, valor")
    .maybeSingle<Pick<ItemBv, "id" | "valor">>();

  if (error) {
    console.error("[bv.cancelar]", error.message);
    return { ok: false, message: "Não foi possível remover o BV." };
  }
  if (!cancelado) return { ok: false, message: "BV não encontrado." };

  await logAuditEvent({
    acao: "item_bv.cancelado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "item_bv",
    entidadeId: cancelado.id,
    metadata: {
      item_versao_id: ctx.item_versao_id,
      job_item_orcado_id: ctx.job_item_orcado_id,
      item: ctx.item,
      valor: cancelado.valor,
      origem,
    },
  });

  revalidarAmbas(ctx);
  return { ok: true, id: cancelado.id };
}
