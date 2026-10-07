"use server";

/** Escritas do SAVE na versão do orçamento.
 *
 *  Regra em `docs/decisions/028-save-entre-jobs.md` (com a nota de
 *  26/08/2026). Duas operações por linha e três do orçamento inteiro
 *  (decisão 154), todas sobre a versão — no job elas passam pela Errata,
 *  que é outro caminho.
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
import { checarPermissao } from "@/lib/permissoes-server";

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string };

interface VersaoDoItem {
  orcamento_id: string;
  status: string;
  save_por_padrao: boolean;
  save_consumo_job_id: string | null;
}

interface ItemDoSave {
  id: string;
  item: string;
  em_save: boolean;
  save_consumido: number;
  total_orcado: number;
  versao_orcamento_id: string;
  versao: VersaoDoItem;
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
        "versao:versoes_orcamento!inner(orcamento_id, status, save_por_padrao, save_consumo_job_id)",
    )
    .eq("id", itemId)
    .eq("tenant_id", tenantId)
    .maybeSingle<ItemDoSave>();

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
  // Com o orçamento inteiro em save, ou consumindo um job, o save não se
  // mexe linha a linha (decisão 154). O gatilho do banco recusa a marca;
  // aqui a recusa vale também para o consumo, que o gatilho não olha.
  if (data.versao.save_por_padrao) {
    return {
      ok: false,
      message:
        "Este orçamento inteiro gera save: o save não se mexe linha a linha. Para mudar uma linha só, retire antes o save do orçamento, no menu Save.",
    };
  }
  if (data.versao.save_consumo_job_id) {
    return {
      ok: false,
      message:
        "Este orçamento inteiro consome o saldo de um job: cada linha consome o próprio orçado. Para mudar uma linha só, retire antes o save do orçamento, no menu Save.",
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
  // Save no orçamento é do administrador e do GP (24/09/2026) — o
  // produtor edita o orçamento, mas não gera nem consome save.
  const gate = await checarPermissao(session, "orcamentos.marcar_em_save", {
    item_id: itemId,
  });
  if (!gate.ok) return gate;
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
  // Save no orçamento é do administrador e do GP (24/09/2026) — o
  // produtor edita o orçamento, mas não gera nem consome save.
  const gate = await checarPermissao(session, "orcamentos.marcar_em_save", {
    item_id: itemId,
  });
  if (!gate.ok) return gate;
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

// ---------------------------------------------------------------------------
// O save do ORÇAMENTO INTEIRO (decisão 154)
// ---------------------------------------------------------------------------
//
// Substituem a chave "Orçamento de save", que só marcava a linha NOVA
// (decisão 028 §10). As três passam por funções do banco que fazem tudo
// numa transação e recusam, com o motivo, o que não pode:
//   • `versao_save_gerar_tudo` — todas as linhas viram save; a linha nova já
//     nasce em save;
//   • `versao_save_consumir_tudo` — todas as linhas consomem o próprio orçado
//     do saldo de UM job; o orçamento maior que o saldo não grava nada;
//   • `versao_save_retirar_tudo` — desfaz o save gerado e o consumo de todas
//     as linhas e desliga o modo.
//
// A permissão é a de quem edita o orçamento — administrador, GP e produtor
// —, a mesma que a chave tinha desde 07/10/2026 (`b024adcd`): o Tiago
// manteve o produtor, porque o saldo só se materializa quando o GP ou o
// administrador envia ao financeiro e o financeiro aprova (decisão 099). A
// RLS das tabelas só exige ser do tenant: sem esta conferência, o
// financeiro mexeria no save pelo console.

type ModoDoSave = "gerar" | "consumir" | "retirar";

async function portaDoModo(
  versaoId: string,
  modo: ModoDoSave,
): Promise<
  | { ok: false; message: string }
  | {
      ok: true;
      tenantId: string;
      supabase: ReturnType<typeof createClient>;
    }
> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "orcamentos.editar", {
    versao_id: versaoId,
    modo_do_save: modo,
  });
  if (!gate.ok) return gate;
  return { ok: true, tenantId: session.activeTenant.id, supabase: createClient() };
}

/** Todas as linhas viram save, e a linha nova já nasce em save. */
export async function gerarSaveNoOrcamentoInteiro(
  versaoId: string,
): Promise<ActionResult> {
  const porta = await portaDoModo(versaoId, "gerar");
  if (!porta.ok) return porta;

  const { data, error } = await porta.supabase.rpc("versao_save_gerar_tudo", {
    p_versao_id: versaoId,
  });
  if (error) {
    console.error("[save.orcamento.gerar]", error.message);
    // As recusas do banco falam português e dizem quais linhas impedem.
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "save.orcamento.gerar_tudo",
    tenantId: porta.tenantId,
    entidadeTipo: "versoes_orcamento",
    entidadeId: versaoId,
    metadata: (data ?? {}) as Record<string, unknown>,
  });

  revalidatePath(`/orcamentos`, "layout");
  return { ok: true };
}

/** Todas as linhas passam a consumir o próprio orçado do saldo do job. */
export async function consumirSaldoNoOrcamentoInteiro(
  versaoId: string,
  jobOrigemId: string,
): Promise<ActionResult> {
  const porta = await portaDoModo(versaoId, "consumir");
  if (!porta.ok) return porta;
  if (!jobOrigemId) {
    return { ok: false, message: "Escolha o job de onde vem o saldo." };
  }

  const { data, error } = await porta.supabase.rpc("versao_save_consumir_tudo", {
    p_versao_id: versaoId,
    p_job_id: jobOrigemId,
  });
  if (error) {
    console.error("[save.orcamento.consumir]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "save.orcamento.consumir_tudo",
    tenantId: porta.tenantId,
    entidadeTipo: "versoes_orcamento",
    entidadeId: versaoId,
    metadata: { job_origem_id: jobOrigemId, ...((data ?? {}) as Record<string, unknown>) },
  });

  revalidatePath(`/orcamentos`, "layout");
  return { ok: true };
}

/** Desfaz o save gerado e o consumo de todas as linhas, e desliga o modo. */
export async function retirarTodosOsSaves(
  versaoId: string,
): Promise<ActionResult> {
  const porta = await portaDoModo(versaoId, "retirar");
  if (!porta.ok) return porta;

  const { data, error } = await porta.supabase.rpc("versao_save_retirar_tudo", {
    p_versao_id: versaoId,
  });
  if (error) {
    console.error("[save.orcamento.retirar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "save.orcamento.retirar_tudo",
    tenantId: porta.tenantId,
    entidadeTipo: "versoes_orcamento",
    entidadeId: versaoId,
    metadata: (data ?? {}) as Record<string, unknown>,
  });

  revalidatePath(`/orcamentos`, "layout");
  return { ok: true };
}
