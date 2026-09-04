/**
 * O marco "todas as PPs deste item já foram geradas" — a gravação.
 *
 * Módulo comum (sem `"use server"`) porque DOIS caminhos gravam a mesma
 * coisa e não podem divergir:
 *
 *   * o formulário da PP, onde a pergunta é obrigatória e a resposta vem
 *     junto do "Gerar PP" ou do "Salvar alterações" (`actions-pp.ts`);
 *   * o painel "Destrinchar realizado", no botão do rodapé e na
 *     confirmação de nova PP num item marcado (`actions-conclusao.ts`).
 *
 * Em arquivo `"use server"` toda export vira Server Action — daí morar
 * aqui, recebendo o client de quem chamou.
 *
 * O que o marco faz, e por que ele é registrado (decisão 052): enquanto
 * o item está em aberto, a previsão de custo dele é o planejado menos as
 * PPs que já viraram título. Marcado, o saldo do planejado morre e o item
 * passa a valer só as PPs. Isso move dinheiro no fluxo de caixa da
 * agência — então tem autor, data e auditoria, e a reabertura aparece no
 * chat do job.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/auth/audit";
import { areaDoPapel } from "@/lib/types";

export interface AplicarConclusaoArgs {
  tenantId: string;
  jobId: string;
  itemRealizadoId: string;
  profileId: string;
  papel: string;
  /** Nome do item, só para o texto do chat e da auditoria. */
  itemNome: string;
  /** `true` marca; `false` reabre. */
  concluido: boolean;
  /** De onde veio a decisão — entra no metadata da auditoria. */
  origem: "formulario_pp" | "painel" | "nova_pp";
}

export type ResultadoConclusao =
  | { ok: true; mudou: boolean }
  | { ok: false; message: string };

/**
 * Grava (ou apaga) o marco do item.
 *
 * Idempotente de propósito: o formulário da PP manda a resposta em toda
 * gravação, e responder "ainda faltam PPs" num item que já estava em
 * aberto não pode virar linha de chat nem evento de auditoria.
 */
export async function aplicarConclusaoDoItem(
  supabase: SupabaseClient,
  args: AplicarConclusaoArgs,
): Promise<ResultadoConclusao> {
  const {
    tenantId,
    jobId,
    itemRealizadoId,
    profileId,
    papel,
    itemNome,
    concluido,
    origem,
  } = args;

  const { data: atual, error: erroLeitura } = await supabase
    .from("jobs_itens_realizado")
    .select("id, pps_concluidas_em")
    .eq("id", itemRealizadoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; pps_concluidas_em: string | null }>();

  if (erroLeitura || !atual) {
    return { ok: false, message: "Item não encontrado na planilha do job." };
  }

  const jaMarcado = atual.pps_concluidas_em !== null;
  if (jaMarcado === concluido) return { ok: true, mudou: false };

  const { error } = await supabase
    .from("jobs_itens_realizado")
    .update(
      concluido
        ? {
            pps_concluidas_em: new Date().toISOString(),
            pps_concluidas_por: profileId,
          }
        : { pps_concluidas_em: null, pps_concluidas_por: null },
    )
    .eq("id", itemRealizadoId)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[item.conclusao.update]", error.message);
    return {
      ok: false,
      message: concluido
        ? "Falha ao marcar o item como concluído."
        : "Falha ao reabrir o item.",
    };
  }

  await logAuditEvent({
    acao: concluido
      ? "item_realizado.pps_concluidas"
      : "item_realizado.pps_reabertas",
    tenantId,
    entidadeTipo: "job_item_realizado",
    entidadeId: itemRealizadoId,
    metadata: { job_id: jobId, item: itemNome, origem },
  });

  // Só a REABERTURA vira mensagem no chat. Ela desfaz uma decisão que já
  // tinha mexido na previsão do job, e quem acompanha o job de fora
  // (financeiro, outro GP) precisa ver que aconteceu. Marcar é o curso
  // normal das coisas e ficaria só ruído no chat.
  if (!concluido) {
    const { error: erroChat } = await supabase.from("jobs_mensagens").insert({
      tenant_id: tenantId,
      job_id: jobId,
      autor_id: profileId,
      area: areaDoPapel(papel),
      texto: `Item "${itemNome}" reaberto para uma nova PP. Ele estava marcado como "todas as PPs geradas", e a previsão de custo dele volta a usar o planejado até alguém marcar de novo.`,
    });
    if (erroChat) {
      // O marco já foi desfeito; o recado é acessório. Não derruba a ação.
      console.error("[item.conclusao.chat]", erroChat.message);
    }
  }

  return { ok: true, mudou: true };
}
