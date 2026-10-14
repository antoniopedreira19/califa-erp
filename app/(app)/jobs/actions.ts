"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { rejeicaoAberturaSchema } from "@/lib/validations/jobs";
import type { JobStatus } from "@/lib/types";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function mapJobDbError(msg: string): string {
  if (msg.includes("uniq_jobs_codigo_por_tenant")) return "Já existe um job com este código.";
  if (msg.includes("uniq_jobs_por_orcamento_ativo")) return "Este orçamento já tem um job ativo.";
  if (msg.includes("jobs_datas_ordem")) return "Data fim precisa ser igual ou posterior à data início.";
  // Trava do banco da decisão 134.
  if (msg.includes("regional_nao_disponivel_em_projetos")) {
    return "Esta regional é só de folha de pagamento e não pode ser usada em jobs.";
  }
  return "Não foi possível salvar o job.";
}

/**
 * `atualizarJob` saiu daqui em 14/10/2026 (decisão 174), junto com o
 * "Editar" da página do job: depois da abertura as informações do job não
 * mudam (Tiago). Antes da abertura, nome, GP, produtor, cidade, regional e
 * datas se revisam no envio para abertura, na tela do orçamento (decisão
 * 057). Mantida exportada, ela seria uma Server Action viva — o produtor
 * trocava pelo console o GP de um job aberto.
 *
 * A equipe do job (quem mais participa e quem envia PP) mora no botão
 * "Equipe": `salvarEquipeDoProjeto`, em app/(app)/jobs/_equipe/actions.ts.
 */

/**
 * `atualizarStatusJob` saiu daqui em 28/09/2026 (revisão da decisão 020).
 * Nenhuma tela a chamava desde 08/09 (057), mas, exportada, era uma
 * Server Action viva: GP e produtor (`jobs.editar_metadata`) conseguiam
 * pelo console passar um job ABERTO para `cancelado`, sem conferir PP,
 * previsão de custo, recebimento ou faturamento. E na pré-abertura ela
 * cancelava o job sem devolver o orçamento a `aprovado` nem o save à
 * versão — o que `cancelarEnvioParaAbertura` faz.
 *
 * O cancelamento antes da abertura é `cancelarEnvioParaAbertura`, em
 * app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/abertura-actions.ts.
 * O depois da abertura é do financeiro e ainda não tem tela; quando tiver,
 * nasce com action própria, que desfaça o que a abertura gravou.
 */

/**
 * Aprovar a abertura NÃO mora mais aqui.
 *
 * Abrir um job passou a exigir registro financeiro — categoria,
 * competência, custo previsto e curva de desembolso —, coletado no
 * formulário da Central Financeira. A action que grava tudo isso e só
 * então muda o status é `abrirJobNoFinanceiro`, em
 * app/(app)/financeiro/abertura-de-job/actions.ts. A antiga
 * `aprovarAberturaJob`, que só trocava o status, foi removida: mantida,
 * seria um caminho paralelo capaz de abrir job sem nenhum desses campos.
 */

export async function rejeitarAberturaJob(
  jobId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: { action: "job.rejeitarAbertura", role: session.activeRole },
    });
    return { ok: false, message: "Só administrador ou financeiro pode rejeitar aberturas de job." };
  }

  const parsed = rejeicaoAberturaSchema.safeParse({
    motivo: formData.get("motivo")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Informe um motivo válido.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, projeto_id, orcamento_id")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: JobStatus; projeto_id: string; orcamento_id: string }>();

  if (!job) return { ok: false, message: "Job não encontrado." };
  if (job.status !== "aguardando_abertura") {
    return { ok: false, message: `Job está em status ${job.status} — não é rejeitável.` };
  }

  const { error } = await supabase
    .from("jobs")
    .update({
      status: "rejeitado_financeiro",
      motivo_rejeicao: parsed.data.motivo,
      // Quando o financeiro devolveu (decisão 136). A produção vê
      // "Devolvido pelo Financeiro em …"; quem devolveu fica na auditoria.
      devolvido_em: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[jobs.rejeitarAbertura]", error.message);
    return { ok: false, message: mapJobDbError(error.message) };
  }

  await logAuditEvent({
    acao: "job.abertura_rejeitada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: { motivo: parsed.data.motivo },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);
  return { ok: true, id: jobId };
}

/**
 * `reenviarJobParaAprovacao` saiu daqui em 08/09/2026 (decisão 057). O
 * reenvio do job devolvido é refazer o formulário de abertura no
 * ORÇAMENTO, sobre o mesmo job — `enviarJobParaAbertura`, em
 * app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/abertura-actions.ts.
 * Mantida, seria um caminho paralelo que devolve o job à fila sem
 * ninguém rever o que o financeiro apontou.
 */
