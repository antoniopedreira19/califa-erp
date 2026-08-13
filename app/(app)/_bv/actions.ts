"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { bvSchema } from "@/lib/validations/bv";
import type { BvSituacao, ItemBv } from "@/lib/types";
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
      .select("job_id, tipo_custo, job:jobs!inner(status)")
      .eq("item_versao_id", itemVersaoId)
      .eq("tenant_id", tenantId)
      .neq("job.status", "cancelado")
      .maybeSingle<{
        job_id: string;
        tipo_custo: string;
        job: { status: string };
      }>(),
  ]);

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
    item: data.item,
  };
}

function revalidarAmbas(ctx: ContextoItem) {
  revalidatePath(
    `/orcamentos/${ctx.projeto_id}/${ctx.orcamento_id}/versoes/${ctx.versao_orcamento_id}`,
  );
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
  };
}

/**
 * Lança ou atualiza o BV do item, mantendo-o em `a_negociar`. Um item tem
 * no máximo um BV (`uniq_bv_item`), então é sempre um upsert por
 * `item_versao_id` — o mesmo registro nas duas telas.
 *
 * A `situacao` nunca vem do formulário. Aqui só existem dois movimentos:
 * nascer em `a_negociar` e ressuscitar um BV cancelado de volta para
 * `a_negociar`. Quem move para `confirmado` é `confirmarBv`.
 */
export async function salvarBv(
  itemVersaoId: string,
  formData: FormData,
  origem: OrigemBv = "orcamento",
): Promise<ActionResult> {
  const session = await requireSession();

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

  // A linha pode existir e estar cancelada: na planilha ela aparece como
  // "+BV", então para o usuário isto é um BV novo — e a auditoria tem que
  // contar a mesma história.
  const { data: existente } = await supabase
    .from("itens_bv")
    .select("id, situacao")
    .eq("item_versao_id", itemVersaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Pick<ItemBv, "id" | "situacao">>();

  if (existente && bvTravado(existente.situacao)) {
    return { ok: false, message: mensagemTravado(existente.situacao) };
  }

  const ativo = existente && existente.situacao !== "cancelado";

  const payload = {
    tenant_id: session.activeTenant.id,
    item_versao_id: itemVersaoId,
    fornecedor_id: parsed.data.fornecedor_id,
    valor: parsed.data.valor,
    prazo_repasse: parsed.data.prazo_repasse,
    // Só entra quando a situação precisa voltar do cancelamento — nos
    // demais casos ela é `a_negociar` e permanece.
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
      origem,
      // Reaproveitar a linha de um BV cancelado apaga os valores antigos
      // (decisão do time): a auditoria é o que guarda o que havia antes.
      ...(existente && !ativo ? { substituiu_cancelado: true } : {}),
    },
  });

  revalidarAmbas(ctx);
  return { ok: true, id: salvo?.id };
}

/**
 * Confirma o BV e o envia ao financeiro: `a_negociar` → `confirmado`.
 * A partir daqui o BV fica travado nas duas telas.
 *
 * Só existe a partir da planilha do job — é lá que o BV é fechado, com o
 * fornecedor já definido. `fornecedor_id` é OBRIGATÓRIO: quem vai receber
 * a comissão precisa ter nome antes de virar cobrança.
 *
 * ⚠️ Hoje esta ação é inalcançável pela interface: o botão de confirmar
 * no popup nasce desabilitado, porque não existe módulo de faturamento
 * para onde enviar. O caminho está pronto para quando existir.
 */
export async function confirmarBv(
  itemVersaoId: string,
): Promise<ActionResult> {
  const session = await requireSession();

  const ctx = await carregarContexto(itemVersaoId, session.activeTenant.id, "job");
  if ("error" in ctx) return { ok: false, message: ctx.error };

  const supabase = createClient();

  const { data: atual } = await supabase
    .from("itens_bv")
    .select("id, valor, situacao, fornecedor_id")
    .eq("item_versao_id", itemVersaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<
      Pick<ItemBv, "id" | "valor" | "situacao" | "fornecedor_id">
    >();

  if (!atual || atual.situacao === "cancelado") {
    return { ok: false, message: "BV não encontrado." };
  }
  if (bvTravado(atual.situacao)) {
    return { ok: false, message: mensagemTravado(atual.situacao) };
  }
  if (!atual.fornecedor_id) {
    return {
      ok: false,
      message: "Informe o fornecedor antes de confirmar o BV.",
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
 * situação vira `cancelado`. O BV cancelado some da planilha (as páginas
 * só carregam os ativos) e o quadrado da calha volta a "+BV", pronto para
 * receber um lançamento novo em cima da mesma linha.
 */
export async function cancelarBv(
  itemVersaoId: string,
  origem: OrigemBv = "orcamento",
): Promise<ActionResult> {
  const session = await requireSession();

  const ctx = await carregarContexto(
    itemVersaoId,
    session.activeTenant.id,
    origem,
  );
  if ("error" in ctx) return { ok: false, message: ctx.error };

  const supabase = createClient();

  const { data: atual } = await supabase
    .from("itens_bv")
    .select("situacao")
    .eq("item_versao_id", itemVersaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Pick<ItemBv, "situacao">>();

  if (atual && bvTravado(atual.situacao)) {
    return { ok: false, message: mensagemTravado(atual.situacao) };
  }

  const { data: cancelado, error } = await supabase
    .from("itens_bv")
    .update({ situacao: "cancelado" })
    .eq("item_versao_id", itemVersaoId)
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
