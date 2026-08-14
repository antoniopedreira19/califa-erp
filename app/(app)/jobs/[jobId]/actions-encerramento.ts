"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  PP_STATUS_EM_ABERTO,
  BV_SITUACAO_EM_ABERTO,
  type JobStatus,
} from "@/lib/types";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string };

/** O que impede o encerramento agora. Vazio = pode encerrar. */
export interface ImpedimentosEncerramento {
  ppsEmAberto: { codigo: string; status: string }[];
  bvsEmAberto: { item: string; situacao: string }[];
  semEnvioFaturamento: boolean;
}

/**
 * Levanta os impedimentos do encerramento — usado tanto pela tela (para
 * explicar antes de o usuário tentar) quanto pela action (que refaz a
 * conta antes de gravar).
 *
 * Regra do time (13/08/2026): job não encerra com PP ou BV em aberto.
 * "Em aberto" é PP que ainda não foi paga e BV que ainda não foi
 * recebido — rejeitada e cancelada não contam, porque não são
 * compromisso nem desembolso.
 */
export async function levantarImpedimentos(
  tenantId: string,
  jobId: string,
  versaoAprovadaId: string,
): Promise<ImpedimentosEncerramento> {
  const supabase = createClient();

  const [ppsRes, bvsRes, envioRes] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select("codigo, status")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .in("status", PP_STATUS_EM_ABERTO),
    // BV pendura no item da VERSÃO, não no job — o caminho passa pela
    // versão aprovada. O `!inner` aqui é filtro, não embed, como na
    // leitura de BVs da página do job.
    supabase
      .from("itens_bv")
      .select(
        "situacao, item:versoes_orcamento_itens!inner(item, versao_orcamento_id)",
      )
      .eq("tenant_id", tenantId)
      .eq("item.versao_orcamento_id", versaoAprovadaId)
      .in("situacao", BV_SITUACAO_EM_ABERTO),
    supabase
      .from("jobs_envio_faturamento")
      .select("id")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  return {
    ppsEmAberto: ((ppsRes.data ?? []) as any[]).map((p) => ({
      codigo: p.codigo,
      status: p.status,
    })),
    bvsEmAberto: ((bvsRes.data ?? []) as any[]).map((b) => ({
      item: b.item?.item ?? "Item",
      situacao: b.situacao,
    })),
    semEnvioFaturamento: !envioRes.data,
  };
}

/**
 * Encerra o job.
 *
 * A partir daqui o job é histórico: não aceita edição, PP nova, BV novo
 * nem lançamento de realizado (`jobEstaCongelado`).
 *
 * Os impedimentos são refeitos aqui dentro — a tela pode ter sido
 * carregada antes de alguém emitir uma PP.
 */
export async function encerrarJob(jobId: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, status, projeto_id, orcamento_id, versao_orcamento_aprovada_id, faturamento_previsto",
    )
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: JobStatus;
      projeto_id: string;
      orcamento_id: string;
      versao_orcamento_aprovada_id: string;
      faturamento_previsto: number | string | null;
    }>();

  if (!job) return { ok: false, message: "Job não encontrado." };

  if (job.status !== "aberto") {
    return {
      ok: false,
      message: `Só job aberto pode ser encerrado. Este está em ${job.status}.`,
    };
  }

  const imp = await levantarImpedimentos(
    session.activeTenant.id,
    jobId,
    job.versao_orcamento_aprovada_id,
  );

  if (imp.semEnvioFaturamento) {
    return {
      ok: false,
      message:
        "Este job ainda não foi enviado para faturamento. Envie antes de encerrar.",
    };
  }

  if (imp.ppsEmAberto.length > 0 || imp.bvsEmAberto.length > 0) {
    const partes: string[] = [];
    if (imp.ppsEmAberto.length > 0) {
      partes.push(
        `${imp.ppsEmAberto.length} ${imp.ppsEmAberto.length === 1 ? "PP sem baixa" : "PPs sem baixa"} (${imp.ppsEmAberto
          .map((p) => p.codigo)
          .join(", ")})`,
      );
    }
    if (imp.bvsEmAberto.length > 0) {
      partes.push(
        `${imp.bvsEmAberto.length} ${imp.bvsEmAberto.length === 1 ? "BV não recebido" : "BVs não recebidos"}`,
      );
    }
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        acao_tentada: "job.encerrado",
        pps_em_aberto: imp.ppsEmAberto.length,
        bvs_em_aberto: imp.bvsEmAberto.length,
      },
    });
    return {
      ok: false,
      message: `Não é possível encerrar: ${partes.join(" e ")}. Dê baixa antes.`,
    };
  }

  const { error } = await supabase
    .from("jobs")
    .update({ status: "encerrado" })
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    // Trava de corrida: se o job saiu de `aberto` entre a leitura e o
    // update, nada é gravado.
    .eq("status", "aberto");

  if (error) {
    console.error("[job.encerrar]", error.message);
    return { ok: false, message: "Não foi possível encerrar o job." };
  }

  await logAuditEvent({
    acao: "job.encerrado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      faturamento: Number(job.faturamento_previsto ?? 0),
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/jobs/${jobId}`);
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);

  return { ok: true, id: jobId };
}
