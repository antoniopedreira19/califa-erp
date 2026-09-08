"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { bvSchema } from "@/lib/validations/bv";
import type { BvSituacao, ItemBv, JobStatus } from "@/lib/types";
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
  item: string;
}

/**
 * Carrega o item e barra tudo que torna o BV inválido: tenant errado,
 * tipo de custo sem BV e versão congelada para a origem da chamada.
 */
async function carregarContexto(
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
  if (!data?.versao) return { error: "Item não encontrado." };

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

  // Job encerrado é histórico: nem lançar, nem confirmar, nem cancelar
  // BV. As três ações passam por aqui, então a trava mora num lugar só.
  // (`cancelado` não chega neste ponto — o filtro acima já o descarta.)
  if (copiaRes.data && jobEstaCongelado(copiaRes.data.job.status as JobStatus)) {
    return {
      error: "Job encerrado — o BV não pode mais ser alterado.",
    };
  }

  // Pré-abertura: o job existe (a cópia nasce no envio para abertura),
  // mas o financeiro ainda não o abriu. A planilha do job passou a ser
  // visível nesse estado em 17/08/2026 e o realizado é editável nele —
  // o BV não: é compromisso de comissão, e o job ainda pode voltar.
  // Sem esta trava a UI escondia o botão, mas a action aceitava.
  if (
    copiaRes.data &&
    !jobAceitaAcoesPlanilha(copiaRes.data.job.status as JobStatus)
  ) {
    return {
      error:
        copiaRes.data.job.status === "rejeitado_financeiro"
          ? "Job devolvido pelo financeiro — o BV fica disponível depois da abertura."
          : "Job aguardando abertura pelo financeiro — o BV fica disponível depois da abertura.",
    };
  }

  // Depois da abertura do job quem manda é a cópia: a errata pode ter
  // mudado o tipo lá, e a versão aprovada não acompanha de propósito.
  // Mesma regra do trigger `bv_exige_item_com_bv`.
  const tipoEfetivo = copiaRes.data?.tipo_custo ?? data.tipo_custo;
  if (!aceitaBV(tipoEfetivo)) {
    return {
      error: "BV só pode ser lançado em item de custo tipo A, A · Repasse ou D.",
    };
  }

  return {
    versao_orcamento_id: data.versao_orcamento_id,
    orcamento_id: data.versao.orcamento_id,
    projeto_id: orcRes.data?.projeto_id ?? "",
    job_id: copiaRes.data?.job_id ?? null,
    job_item_orcado_id: copiaRes.data?.id ?? null,
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
  itemVersaoId: string,
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

  const ctx = await carregarContexto(
    itemVersaoId,
    session.activeTenant.id,
    origem,
  );
  if ("error" in ctx) return { ok: false, message: ctx.error };

  const supabase = createClient();

  // Editando um BV específico: ele precisa existir, ser deste item e
  // ainda estar aberto. Sem o `.eq("item_versao_id")` um id de outra
  // linha passaria — a chave do BV é o id dele, mas quem autoriza é o
  // item que o contexto validou.
  let existente: Pick<ItemBv, "id" | "situacao"> | null = null;
  if (bvId) {
    const { data } = await supabase
      .from("itens_bv")
      .select("id, situacao")
      .eq("id", bvId)
      .eq("item_versao_id", itemVersaoId)
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
    item_versao_id: itemVersaoId,
    // A planilha do job lê o BV por esta chave. Gravar aqui é o que
    // impede o BV lançado no orçamento de sumir depois que o job nasce —
    // e o `?? {}` deixa o BV pré-job em paz até a abertura preenchê-la.
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
      item_versao_id: itemVersaoId,
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
    .select("id, valor, situacao, fornecedor_id, percentual_imposto, item_versao_id")
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
      >
    >();

  if (!atual || atual.situacao === "cancelado" || !atual.item_versao_id) {
    return { ok: false, message: "BV não encontrado." };
  }

  const itemVersaoId = atual.item_versao_id;
  const ctx = await carregarContexto(itemVersaoId, session.activeTenant.id, "job");
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
      item_versao_id: itemVersaoId,
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
    .select("id, situacao, item_versao_id")
    .eq("id", bvId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Pick<ItemBv, "id" | "situacao" | "item_versao_id">>();

  if (!atual || !atual.item_versao_id) {
    return { ok: false, message: "BV não encontrado." };
  }
  if (bvTravado(atual.situacao)) {
    return { ok: false, message: mensagemTravado(atual.situacao) };
  }

  const itemVersaoId = atual.item_versao_id;
  const ctx = await carregarContexto(
    itemVersaoId,
    session.activeTenant.id,
    origem,
  );
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
      item_versao_id: itemVersaoId,
      item: ctx.item,
      valor: cancelado.valor,
      origem,
    },
  });

  revalidarAmbas(ctx);
  return { ok: true, id: cancelado.id };
}
