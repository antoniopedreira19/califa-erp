"use server";

/** Escritas do SAVE na versão do orçamento.
 *
 *  Regra em `docs/decisions/028-save-entre-jobs.md` (com a nota de
 *  26/08/2026). Três operações, todas sobre a versão — no job elas passam
 *  pela Errata, que é outro caminho.
 *
 *  As invariantes duras (teto do orçado da linha, saldo do job de origem,
 *  linha que não gera e consome ao mesmo tempo) moram no trigger
 *  `save_consumo_valida` do banco. Aqui a validação é a de porta: sessão,
 *  tenant, versão editável — e a mensagem legível quando o banco recusa.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string };

interface ItemDoSave {
  id: string;
  item: string;
  em_save: boolean;
  save_consumido: number;
  total_orcado: number;
  versao_orcamento_id: string;
  versao: { orcamento_id: string; status: string };
}

/** Carrega o item e a versão dele, recusando o que não é editável.
 *
 *  União discriminada por `ok`, e não por presença de `erro`: com `in` o
 *  TypeScript não estreita direito quando os dois lados vêm de `return`s
 *  diferentes, e a mensagem vira `string | undefined`. */
type CargaDoItem =
  | { ok: false; message: string }
  | { ok: true; item: ItemDoSave; supabase: ReturnType<typeof createClient> };

async function itemEditavel(
  itemId: string,
  tenantId: string,
): Promise<CargaDoItem> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("versoes_orcamento_itens")
    .select(
      "id, item, em_save, save_consumido, total_orcado, versao_orcamento_id, " +
        "versao:versoes_orcamento!inner(orcamento_id, status)",
    )
    .eq("id", itemId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      item: string;
      em_save: boolean;
      save_consumido: number;
      total_orcado: number;
      versao_orcamento_id: string;
      versao: { orcamento_id: string; status: string };
    }>();

  if (error) {
    console.error("[save.item]", error.message);
    return { ok: false, message: "Não foi possível carregar o item." };
  }
  if (!data?.versao) return { ok: false, message: "Item não encontrado." };
  if (data.versao.status === "aprovada") {
    // Depois da aprovação o caminho é a Errata, no job — ela registra o
    // efeito nos dois números, que é exatamente o que marcar save faz.
    return {
      ok: false,
      message:
        "Versão aprovada não permite alterar o save aqui. Use a Errata na Planilha Interna do job.",
    };
  }
  return { ok: true, item: data, supabase };
}

/**
 * Liga ou desliga o SAVE de uma linha.
 *
 * Marcar tira a linha da base do valor do job e a deixa na do faturamento
 * (decisão 028 §1). O planejado dela zera sozinho — quem faz isso é o
 * trigger `planejado_espelha_orcado`, não esta action.
 */
export async function marcarSaveDaLinha(
  itemId: string,
  marcar: boolean,
): Promise<ActionResult> {
  const session = await requireSession();
  const carga = await itemEditavel(itemId, session.activeTenant.id);
  if (!carga.ok) return carga;
  const { item, supabase } = carga;

  if (marcar && Number(item.save_consumido ?? 0) > 0) {
    return {
      ok: false,
      message:
        "Esta linha é paga por saldo de save de outro job. Remova o consumo antes de transformá-la em save.",
    };
  }

  const { error } = await supabase
    .from("versoes_orcamento_itens")
    .update({ em_save: marcar })
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[save.marcar]", error.message);
    return { ok: false, message: "Não foi possível gravar o save da linha." };
  }

  await logAuditEvent({
    acao: marcar ? "save.linha.marcada" : "save.linha.desmarcada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versoes_orcamento_itens",
    entidadeId: itemId,
    metadata: { item: item.item, total_orcado: Number(item.total_orcado ?? 0) },
  });

  revalidatePath(`/orcamentos`, "layout");
  return { ok: true };
}

/** Uma origem escolhida no pop-up: de qual job, e quanto. */
export interface OrigemEscolhida {
  jobOrigemId: string;
  valor: number;
}

/**
 * Reescreve o consumo de save de uma linha.
 *
 * Recebe a lista inteira porque o pop-up edita o conjunto: a linha pode
 * beber de vários jobs, e mexer numa origem costuma vir junto de mexer
 * noutra. Apagar e regravar mantém a action com uma única semântica.
 *
 * Passar lista vazia limpa o consumo — é o "Remover save" do design.
 */
export async function salvarConsumoDeSave(
  itemId: string,
  origens: OrigemEscolhida[],
): Promise<ActionResult> {
  const session = await requireSession();
  const carga = await itemEditavel(itemId, session.activeTenant.id);
  if (!carga.ok) return carga;
  const { item, supabase } = carga;

  if (item.em_save && origens.length > 0) {
    return {
      ok: false,
      message:
        "Uma linha não pode gerar e consumir save ao mesmo tempo. Desmarque o save desta linha primeiro.",
    };
  }

  const limpas = origens
    .map((o) => ({ ...o, valor: Number(o.valor) }))
    .filter((o) => o.jobOrigemId && Number.isFinite(o.valor) && o.valor > 0);

  const total = limpas.reduce((s, o) => s + o.valor, 0);
  const orcado = Number(item.total_orcado ?? 0);
  // Consumo parcial é permitido (decisão 028 §6): o que sobra segue
  // faturado normalmente. O que não pode é passar do orçado da linha.
  if (total > orcado + 0.005) {
    return {
      ok: false,
      message: `O consumo de save não pode passar do orçado da linha (R$ ${orcado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}).`,
    };
  }

  const { error: delErr } = await supabase
    .from("saves_consumos")
    .delete()
    .eq("item_versao_id", itemId)
    .eq("tenant_id", session.activeTenant.id);

  if (delErr) {
    console.error("[save.consumo.limpar]", delErr.message);
    return { ok: false, message: "Não foi possível atualizar o consumo." };
  }

  if (limpas.length > 0) {
    const { error: insErr } = await supabase.from("saves_consumos").insert(
      limpas.map((o) => ({
        tenant_id: session.activeTenant.id,
        job_origem_id: o.jobOrigemId,
        item_versao_id: itemId,
        valor: o.valor,
        created_by: session.profile.id ?? null,
      })),
    );

    if (insErr) {
      console.error("[save.consumo.gravar]", insErr.message);
      // O trigger do banco fala português e nomeia o job e os valores —
      // é uma mensagem melhor do que qualquer genérica daqui.
      return { ok: false, message: insErr.message };
    }
  }

  await logAuditEvent({
    acao: "save.consumo.definido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versoes_orcamento_itens",
    entidadeId: itemId,
    metadata: {
      item: item.item,
      origens: limpas.length,
      total_consumido: total,
    },
  });

  revalidatePath(`/orcamentos`, "layout");
  return { ok: true };
}

/**
 * Liga ou desliga o "Orçamento de save" da versão.
 *
 * É DEFAULT de linha nova, não trava: as linhas que já existem não mudam,
 * e desligar não desmarca nada (decisão 028 §10). Quem marca a linha nova
 * é o trigger `item_nasce_em_save`.
 */
export async function definirSavePorPadrao(
  versaoId: string,
  ligado: boolean,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: versao, error: loadErr } = await supabase
    .from("versoes_orcamento")
    .select("id, status")
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: string }>();

  if (loadErr || !versao) {
    return { ok: false, message: "Versão não encontrada." };
  }
  if (versao.status === "aprovada") {
    return { ok: false, message: "Versão aprovada não permite alterações." };
  }

  const { error } = await supabase
    .from("versoes_orcamento")
    .update({ save_por_padrao: ligado })
    .eq("id", versaoId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[save.padrao]", error.message);
    return { ok: false, message: "Não foi possível gravar a chave." };
  }

  await logAuditEvent({
    acao: ligado ? "save.orcamento.ligado" : "save.orcamento.desligado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "versoes_orcamento",
    entidadeId: versaoId,
  });

  revalidatePath(`/orcamentos`, "layout");
  return { ok: true };
}
