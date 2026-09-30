"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { jobSchema, rejeicaoAberturaSchema } from "@/lib/validations/jobs";
import {
  jobEstaCongelado,
  jobStatusLabel,
  type JobStatus,
} from "@/lib/types";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

// `valor_total` e `faturamento_previsto` NÃO entram aqui de propósito: os
// dois são derivados dos itens orçados do job (ver `calcularTotaisVersao`)
// e só são reescritos pela abertura e pelas erratas. Já existiu um campo
// editável no drawer que gravava valor_total à mão — o JOB-0001 ficou com
// R$ 1.000.000 sobre R$ 5.617 de itens, e o card de Totais e a listagem
// passaram a contar histórias diferentes.
function extractInput(formData: FormData) {
  return {
    nome: formData.get("nome")?.toString() ?? "",
    produto: formData.get("produto")?.toString() ?? "",
    regional_id: formData.get("regional_id")?.toString() ?? "",
    cidade: formData.get("cidade")?.toString() ?? "",
    data_inicio_prevista: formData.get("data_inicio_prevista")?.toString() ?? "",
    data_fim_prevista: formData.get("data_fim_prevista")?.toString() ?? "",
    responsavel_id: formData.get("responsavel_id")?.toString() ?? "",
  };
}

function mapJobDbError(msg: string): string {
  if (msg.includes("uniq_jobs_codigo_por_tenant")) return "Já existe um job com este código.";
  if (msg.includes("uniq_jobs_por_orcamento_ativo")) return "Este orçamento já tem um job ativo.";
  if (msg.includes("jobs_datas_ordem")) return "Data fim precisa ser igual ou posterior à data início.";
  // Trava do banco da decisão 134: o editor não confere a regional.
  if (msg.includes("regional_nao_disponivel_em_projetos")) {
    return "Esta regional é só de folha de pagamento e não pode ser usada em jobs.";
  }
  return "Não foi possível salvar o job.";
}

export async function atualizarJob(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.editar_metadata");
  if (!gate.ok) return gate;
  const parsed = jobSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  // Job encerrado ou cancelado é histórico: nada mais nele é editado.
  // A trava é aqui e não só no botão porque a action é o que grava.
  const { data: atual } = await supabase
    .from("jobs")
    .select("status")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ status: JobStatus }>();

  if (!atual) return { ok: false, message: "Job não encontrado." };

  if (jobEstaCongelado(atual.status)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: id,
      metadata: {
        acao_tentada: "job.atualizado",
        motivo: "status_bloqueia_edicao",
        status_atual: atual.status,
      },
    });
    return {
      ok: false,
      message: `Job ${jobStatusLabel(atual.status).toLowerCase()} — não pode mais ser editado.`,
    };
  }

  // Apenas campos operacionais são atualizáveis aqui — hierarquia e status têm actions próprias
  const { error } = await supabase
    .from("jobs")
    .update({
      nome: parsed.data.nome,
      produto: parsed.data.produto,
      regional_id: parsed.data.regional_id,
      cidade: parsed.data.cidade,
      data_inicio_prevista: parsed.data.data_inicio_prevista,
      data_fim_prevista: parsed.data.data_fim_prevista,
      responsavel_id: parsed.data.responsavel_id,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[jobs.atualizar]", error.message);
    return { ok: false, message: mapJobDbError(error.message) };
  }

  await logAuditEvent({
    acao: "job.atualizado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: id,
  });

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  return { ok: true, id };
}

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
