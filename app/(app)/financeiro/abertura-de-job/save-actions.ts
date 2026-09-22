"use server";

/**
 * A recusa de um pedido de save, na faixa Saves da Abertura de Job
 * (decisão 099, 22/09/2026).
 *
 * A APROVAÇÃO não mora aqui: aprovar é registrar a revisão da abertura
 * (`editarRegistroDaAbertura`, em `actions.ts`, com o id do pedido) — só
 * esse registro aprova.
 *
 * Tudo que muda no banco muda pela RPC `decidir_pedido_save`, numa
 * transação: a situação do pedido, a linha de volta ao estado de logo
 * antes dele, os espelhos do job (quando o financeiro já contava a linha)
 * e a revisão da abertura. As mensagens de erro da RPC já vêm em pt-BR e
 * vão direto para a tela.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { revisaoPendenteDoJob } from "@/lib/data/saves";
import {
  espelhosDe,
  lerBaseDosEspelhos,
  totaisDoFinanceiro,
  type EspelhosDoJob,
} from "@/lib/data/espelhos-do-job";
import type {
  OrigemDeSave,
  SaveAprovacaoMomento,
  SaveAprovacaoTipo,
} from "@/lib/types";
import { linhaSemOSave } from "./aprovacao-save";

export type RecusaResult = { ok: true } | { ok: false; message: string };

const MIN_JUSTIFICATIVA = 10;
const MAX_JUSTIFICATIVA = 500;

const dinheiro = (n: number) => Number(n.toFixed(2));

/** A errata de save que a RPC grava (`p_errata`) — a mesma forma de
 *  `save-errata-actions.ts`, do outro lado do fluxo. */
interface ErrataDaRecusa {
  titulo: string;
  custo_orcado_antes: number;
  custo_orcado_depois: number;
  valor_job_antes: number;
  valor_job_depois: number;
  faturamento_previsto_antes: number;
  faturamento_previsto_depois: number;
}

/** Os títulos seguem o padrão das erratas de save da produção
 *  (`Save: "{item}" ...`), dizendo quem decidiu. */
const tituloRecusaGera = (item: string) =>
  `Save: "${item}" recusado pelo financeiro`;
const tituloRecusaConsome = (item: string) =>
  `Save: consumo de "${item}" recusado pelo financeiro`;

export async function recusarPedidoDeSave(
  pedidoId: string,
  justificativa: string,
): Promise<RecusaResult> {
  const session = await requireSession();
  // Quem decide save é quem abre job no financeiro: administrador e
  // financeiro. O banco confere o papel de novo na RPC.
  const gate = await checarPermissao(session, "jobs.abrir_financeiro", {
    action: "save.recusarPedido",
    pedido_id: pedidoId,
  });
  if (!gate.ok) return gate;

  const texto = justificativa.trim();
  if (texto.length < MIN_JUSTIFICATIVA) {
    return {
      ok: false,
      message: `Escreva a justificativa com pelo menos ${MIN_JUSTIFICATIVA} caracteres.`,
    };
  }
  if (texto.length > MAX_JUSTIFICATIVA) {
    return {
      ok: false,
      message: `A justificativa passa de ${MAX_JUSTIFICATIVA} caracteres.`,
    };
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: pedido, error: pedidoErr } = await supabase
    .from("saves_aprovacoes")
    .select(
      "id, job_id, job_item_orcado_id, tipo, situacao, momento, valor, item_descricao, grupo_nome, origens_antes",
    )
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      job_id: string;
      job_item_orcado_id: string | null;
      tipo: SaveAprovacaoTipo;
      situacao: string;
      momento: SaveAprovacaoMomento;
      valor: number | string;
      item_descricao: string;
      grupo_nome: string | null;
      origens_antes: OrigemDeSave[] | null;
    }>();
  if (pedidoErr) console.error("[save.recusar.pedido]", pedidoErr.message);
  if (!pedido) return { ok: false, message: "Pedido de save não encontrado." };
  if (pedido.situacao !== "aguardando") {
    return {
      ok: false,
      message: "Este pedido de save já foi decidido — outra pessoa pode ter aprovado ou recusado enquanto você escrevia.",
    };
  }

  // ---- Os números e a revisão ----
  // Pedido `job_aberto`: o financeiro ainda não contava a linha, então os
  // espelhos não mudam. A revisão da abertura que o pedido abriu se
  // encerra sozinha quando ele era a única pendência desde a última
  // abertura/revisão registrada; senão fica como está.
  //
  // Pedido de outro momento (abertura, reenvio, legado): a linha já
  // contava desde a abertura. A recusa tira a linha dos números — os
  // espelhos são recalculados com ela revertida — e vira ERRATA DE SAVE
  // (migration 20260922140007): sem a errata, a regra "revisão só de
  // save" olhava apenas as erratas dos pedidos, achava que a próxima
  // decisão era a única pendência e fechava a revisão sobre os números de
  // antes desta recusa. A errata que a RPC grava já põe o job em revisão
  // — por isso `p_revisao = 'manter'`.
  let totais: EspelhosDoJob | null = null;
  let errata: ErrataDaRecusa | null = null;
  let revisao: "manter" | "fechar" | "abrir";
  if (pedido.momento === "job_aberto") {
    const pendente = await revisaoPendenteDoJob(
      supabase,
      tenantId,
      pedido.job_id,
      pedido.id,
    );
    revisao = pendente.podeFechar ? "fechar" : "manter";
  } else {
    if (!pedido.job_item_orcado_id) {
      return {
        ok: false,
        message: "A linha deste pedido de save foi removida: ele não pode ser decidido.",
      };
    }
    const lida = await lerBaseDosEspelhos(supabase, tenantId, pedido.job_id);
    if (!lida.ok) return { ok: false, message: lida.message };
    const consumoAntes = (pedido.origens_antes ?? []).reduce(
      (s, o) => s + Number(o.valor ?? 0),
      0,
    );
    const antes = totaisDoFinanceiro(lida.base.itens, lida.base);
    const depois = totaisDoFinanceiro(
      linhaSemOSave(
        lida.base.itens,
        pedido.job_item_orcado_id,
        pedido.tipo,
        consumoAntes,
      ),
      lida.base,
    );
    totais = espelhosDe(depois);
    errata = {
      titulo:
        pedido.tipo === "gera"
          ? tituloRecusaGera(pedido.item_descricao)
          : tituloRecusaConsome(pedido.item_descricao),
      // O save não mexe no custo orçado: os dois lados são o mesmo
      // número, e é isso que a errata registra.
      custo_orcado_antes: dinheiro(antes.subtotalGeral),
      custo_orcado_depois: dinheiro(depois.subtotalGeral),
      valor_job_antes: dinheiro(antes.valorJob),
      valor_job_depois: dinheiro(depois.valorJob),
      faturamento_previsto_antes: dinheiro(antes.faturamentoPrevisto),
      faturamento_previsto_depois: dinheiro(depois.faturamentoPrevisto),
    };
    // A errata já abre a revisão da abertura (`save_registrar_errata`).
    revisao = "manter";
  }

  const { error: rpcErr } = await supabase.rpc("decidir_pedido_save", {
    p_id: pedido.id,
    p_decisao: "recusar",
    p_justificativa: texto,
    p_totais: totais,
    p_revisao: revisao,
    p_errata: errata,
  });
  if (rpcErr) {
    console.error("[save.recusar.rpc]", rpcErr.message);
    return { ok: false, message: rpcErr.message };
  }

  await logAuditEvent({
    acao: "save.pedido.recusado",
    tenantId,
    entidadeTipo: "job",
    entidadeId: pedido.job_id,
    metadata: {
      pedido_id: pedido.id,
      job_item_orcado_id: pedido.job_item_orcado_id,
      tipo: pedido.tipo,
      momento: pedido.momento,
      item: pedido.item_descricao,
      grupo: pedido.grupo_nome,
      valor: Number(pedido.valor ?? 0),
      justificativa: texto,
      revisao,
      totais,
      ...(errata
        ? {
            titulo: errata.titulo,
            valor_job_antes: errata.valor_job_antes,
            valor_job_depois: errata.valor_job_depois,
            faturamento_previsto_antes: errata.faturamento_previsto_antes,
            faturamento_previsto_depois: errata.faturamento_previsto_depois,
          }
        : {}),
    },
  });

  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/jobs/${pedido.job_id}`);
  revalidatePath(`/jobs/${pedido.job_id}`);
  revalidatePath("/jobs");

  return { ok: true };
}
