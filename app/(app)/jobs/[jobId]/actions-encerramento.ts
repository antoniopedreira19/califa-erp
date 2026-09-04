"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes";
import { saldoAFaturarDoJob } from "@/lib/data/saldo-a-faturar";
import {
  PP_STATUS_EM_ABERTO,
  BV_SITUACAO_EM_ABERTO,
  type JobStatus,
} from "@/lib/types";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string };

function formatarBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** O que impede o encerramento agora. Vazio = pode encerrar. */
export interface ImpedimentosEncerramento {
  ppsEmAberto: { codigo: string; status: string }[];
  bvsEmAberto: { item: string; situacao: string }[];
  semEnvioFaturamento: boolean;
  /** Quanto do envio ainda não virou nota emitida. Zero = tudo faturado. */
  saldoAFaturar: number;
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
 *
 * E não encerra com saldo a faturar (31/08/2026). Até aqui o portão era
 * só o ENVIO: bastava a produção ter mandado o job para a fila, mesmo
 * que nenhuma nota tivesse saído. Como `vw_faturamento_pendente` filtra
 * `status = 'aberto'`, o job encerrado sumia da fila levando junto o que
 * faltava faturar, sem aviso e sem caminho de volta — aconteceu com o
 * JOB-0027, encerrado com R$ 30.073,32 em duas parcelas nunca emitidas.
 */
export async function levantarImpedimentos(
  tenantId: string,
  jobId: string,
  versaoAprovadaId: string,
): Promise<ImpedimentosEncerramento> {
  const supabase = createClient();

  const [ppsRes, bvsRes, envioRes, saldoAFaturar] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select("codigo, status")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .in("status", PP_STATUS_EM_ABERTO),
    // BV pendura na CÓPIA do job desde 27/08/2026 — pelo caminho antigo
    // (versão aprovada) o BV de uma linha criada por errata ficaria de
    // fora, e o job encerraria com comissão em aberto. O `!inner` aqui é
    // filtro, não embed, como na leitura de BVs da página do job.
    supabase
      .from("itens_bv")
      .select("situacao, copia:jobs_itens_orcado!inner(item, job_id)")
      .eq("tenant_id", tenantId)
      .eq("copia.job_id", jobId)
      .in("situacao", BV_SITUACAO_EM_ABERTO),
    supabase
      .from("jobs_envio_faturamento")
      .select("id")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    saldoAFaturarDoJob(tenantId, jobId),
  ]);

  return {
    ppsEmAberto: ((ppsRes.data ?? []) as any[]).map((p) => ({
      codigo: p.codigo,
      status: p.status,
    })),
    bvsEmAberto: ((bvsRes.data ?? []) as any[]).map((b) => ({
      item: b.copia?.item ?? "Item",
      situacao: b.situacao,
    })),
    semEnvioFaturamento: !envioRes.data,
    saldoAFaturar,
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
  const gate = await checarPermissao(session, "jobs.encerrar");
  if (!gate.ok) return gate;
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
    // EXCEÇÃO DO SAVE (decisão 028 §11). Um job pago inteiramente por
    // saldo de save tem faturamento previsto ZERO — e aí ele trava dos
    // dois lados: `enviarJobParaFaturamento` recusa valor zero, e a
    // decisão 008 §1 só encerra quem foi enviado. O job ficaria aberto
    // para sempre.
    //
    // Não há nota a emitir: ela já saiu no job que gerou o crédito. A
    // condição é dupla de propósito — faturamento zero E consumo de save
    // —, porque job com faturamento zero e SEM save é outra coisa (um
    // orçado vazio, que continua tendo de passar pelo faturamento).
    const previsto = Number(job.faturamento_previsto ?? 0);
    const { count: consumosDeSave } = await supabase
      .from("saves_consumos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .in(
        "job_item_orcado_id",
        (
          await supabase
            .from("jobs_itens_orcado")
            .select("id")
            .eq("job_id", jobId)
            .eq("tenant_id", session.activeTenant.id)
        ).data?.map((o) => o.id) ?? [],
      );

    const pagoSoPorSave = previsto <= 0.004 && (consumosDeSave ?? 0) > 0;

    if (!pagoSoPorSave) {
      return {
        ok: false,
        message:
          "Este job ainda não foi enviado para faturamento. Envie antes de encerrar.",
      };
    }
  }

  if (
    imp.ppsEmAberto.length > 0 ||
    imp.bvsEmAberto.length > 0 ||
    imp.saldoAFaturar > 0
  ) {
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
    // O saldo a faturar entra na MESMA lista, e não numa trava à parte,
    // para quem tenta encerrar ver de uma vez tudo o que falta — em vez
    // de resolver a PP, tentar de novo e esbarrar na nota.
    if (imp.saldoAFaturar > 0) {
      partes.push(`${formatarBRL(imp.saldoAFaturar)} ainda a faturar`);
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
        saldo_a_faturar: imp.saldoAFaturar,
      },
    });
    const comoResolver =
      imp.saldoAFaturar > 0
        ? imp.ppsEmAberto.length > 0 || imp.bvsEmAberto.length > 0
          ? " Dê baixa nos documentos e peça ao financeiro a nota do saldo."
          : " O financeiro precisa emitir a nota do saldo antes do encerramento."
        : " Dê baixa antes.";
    return {
      ok: false,
      message: `Não é possível encerrar: ${partes.join(" e ")}.${comoResolver}`,
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
