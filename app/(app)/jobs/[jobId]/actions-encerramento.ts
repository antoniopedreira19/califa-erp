"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import {
  situacaoVerbaLabel,
  jobStatusLabel,
  jobEstaAberto,
  JOB_STATUS_ABERTO,
  type JobStatus,
} from "@/lib/types";
import { impedimentosDosJobs } from "@/lib/data/impedimentos-encerramento";

export type ActionResult =
  | { ok: true; id: string; status: JobStatus }
  | { ok: false; message: string };

// Os impedimentos saíram daqui em 25/09/2026 (decisão 105) para
// `lib/data/impedimentos-encerramento.ts`: a mesma régua agora alimenta o
// card "Jobs prontos pra encerrar" da home e o filtro da lista de jobs, e
// três cópias dela divergiriam no primeiro ajuste. Aqui o encerramento
// refaz a conta antes de gravar — a tela pode ter sido carregada antes de
// alguém emitir uma PP.

/** "Item 1, Item 2" — os itens de um impedimento de save, entre parênteses
 *  na mensagem. */
function listaDeItens(itens: { item: string }[]): string {
  return itens.map((i) => i.item).join(", ");
}

/**
 * Envia o job para encerramento.
 *
 * A partir daqui o job é histórico: não aceita edição, PP nova, BV novo nem
 * lançamento de realizado (`jobEstaCongelado`). O ENVIO PARA FATURAMENTO
 * continua aceito — o job pode ser encerrado antes de ser faturado
 * (decisão 087).
 *
 * Se todo o faturamento já foi ENVIADO ao financeiro — ou o job não tem o
 * que faturar —, o banco grava `finalizado` no lugar de `encerrado` (gatilho
 * `trg_jobs_finaliza_ao_encerrar`); a action devolve o status que ficou.
 * Desde 20/09/2026 (decisão 094) a nota não entra nesta conta.
 *
 * Os impedimentos são refeitos aqui dentro — a tela pode ter sido
 * carregada antes de alguém emitir uma PP.
 *
 * ⚠️ Hoje o envio encerra na hora. O Tiago definiu em 16/09/2026 que ele
 * vira um pedido que o financeiro confirma; esse fluxo será desenhado
 * depois desta entrega.
 */
export async function encerrarJob(jobId: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.encerrar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, projeto_id, orcamento_id, faturamento_previsto, abertura_em_revisao")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: JobStatus;
      projeto_id: string;
      orcamento_id: string;
      faturamento_previsto: number | string | null;
      abertura_em_revisao: boolean | null;
    }>();

  if (!job) return { ok: false, message: "Job não encontrado." };

  if (!jobEstaAberto(job.status)) {
    return {
      ok: false,
      message: `Só job aberto pode ser enviado para encerramento. Este está ${jobStatusLabel(job.status).toLowerCase()}.`,
    };
  }

  const imp =
    (await impedimentosDosJobs(supabase, session.activeTenant.id, [jobId])).get(jobId) ??
    null;
  if (!imp) return { ok: false, message: "Não foi possível conferir o job. Tente de novo." };

  if (
    imp.ppsEmAberto.length > 0 ||
    imp.verbasEmAberto.length > 0 ||
    imp.bvsEmAberto.length > 0 ||
    imp.itensSemMarcacao.length > 0 ||
    imp.savesAguardando.length > 0 ||
    imp.consumosAguardando.length > 0 ||
    imp.savesNaoEnviados.length > 0 ||
    imp.revisaoDaAberturaPendente
  ) {
    const partes: string[] = [];
    if (imp.ppsEmAberto.length > 0) {
      partes.push(
        `${imp.ppsEmAberto.length} ${imp.ppsEmAberto.length === 1 ? "PP em aberto" : "PPs em aberto"} (${imp.ppsEmAberto
          .map((p) => p.codigo)
          .join(", ")})`,
      );
    }
    if (imp.verbasEmAberto.length > 0) {
      partes.push(
        `${imp.verbasEmAberto.length} ${imp.verbasEmAberto.length === 1 ? "verba de produção não concluída" : "verbas de produção não concluídas"} (${imp.verbasEmAberto
          .map((v) => `${v.codigo}: ${situacaoVerbaLabel(v.situacao).toLowerCase()}`)
          .join(", ")})`,
      );
    }
    if (imp.bvsEmAberto.length > 0) {
      partes.push(
        `${imp.bvsEmAberto.length} ${imp.bvsEmAberto.length === 1 ? "BV não recebido" : "BVs não recebidos"}`,
      );
    }
    if (imp.itensSemMarcacao.length > 0) {
      partes.push(
        `${imp.itensSemMarcacao.length} ${
          imp.itensSemMarcacao.length === 1
            ? "item de custo sem dizer se ainda sai PP"
            : "itens de custo sem dizer se ainda sai PP"
        }`,
      );
    }
    // Os textos da trilha "Encerramento" (decisão 099, §3 da especificação).
    if (imp.savesAguardando.length > 0) {
      const n = imp.savesAguardando.length;
      partes.push(
        `${n} ${n === 1 ? "save aguardando" : "saves aguardando"} aprovação do financeiro (${listaDeItens(imp.savesAguardando)})`,
      );
    }
    if (imp.consumosAguardando.length > 0) {
      const n = imp.consumosAguardando.length;
      partes.push(
        `${n} ${n === 1 ? "consumo de save aguardando" : "consumos de save aguardando"} aprovação do financeiro (${listaDeItens(imp.consumosAguardando)})`,
      );
    }
    if (imp.savesNaoEnviados.length > 0) {
      const n = imp.savesNaoEnviados.length;
      partes.push(
        `${n} ${n === 1 ? "save ainda não enviado" : "saves ainda não enviados"} para aprovação (${listaDeItens(imp.savesNaoEnviados)})`,
      );
    }
    if (imp.revisaoDaAberturaPendente) {
      partes.push("revisão da abertura pendente no financeiro");
    }
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        acao_tentada: "job.encerrado",
        pps_em_aberto: imp.ppsEmAberto.length,
        verbas_em_aberto: imp.verbasEmAberto.map((v) => v.codigo),
        bvs_em_aberto: imp.bvsEmAberto.length,
        itens_sem_marcacao: imp.itensSemMarcacao.length,
        saves_aguardando: imp.savesAguardando.length,
        consumos_aguardando: imp.consumosAguardando.length,
        saves_nao_enviados: imp.savesNaoEnviados.length,
        revisao_da_abertura_pendente: imp.revisaoDaAberturaPendente,
      },
    });
    const comoResolver: string[] = [];
    if (imp.ppsEmAberto.length > 0 || imp.bvsEmAberto.length > 0) {
      comoResolver.push("Dê baixa nos documentos antes.");
    }
    if (imp.verbasEmAberto.length > 0) {
      comoResolver.push(
        "A produção presta contas da verba na aba de PPs, e o financeiro aprova a prestação.",
      );
    }
    if (imp.itensSemMarcacao.length > 0) {
      comoResolver.push(
        "Marque nos itens que faltam, pelo painel do item na Planilha Interna, que todas as PPs deles já foram geradas.",
      );
    }
    const naoEnviadosComRecusa = imp.savesNaoEnviados.filter((s) => s.comRecusa);
    if (naoEnviadosComRecusa.length < imp.savesNaoEnviados.length) {
      comoResolver.push(
        "Envie os saves pelo botão “Enviar saves para aprovação”, acima da planilha.",
      );
    }
    // O botão não envia linha com recusa ainda não arquivada (decisão 099).
    if (naoEnviadosComRecusa.length > 0) {
      comoResolver.push(
        `Em ${naoEnviadosComRecusa.map((s) => `“${s.item}”`).join(", ")}, retire antes a recusa no pop-up de save da linha: o botão “Enviar saves para aprovação” não envia linha com recusa.`,
      );
    }
    if (
      imp.savesAguardando.length > 0 ||
      imp.consumosAguardando.length > 0 ||
      imp.revisaoDaAberturaPendente
    ) {
      comoResolver.push("O envio para encerramento volta quando o financeiro decidir.");
    }
    return {
      ok: false,
      message: `Não é possível enviar para encerramento: ${partes.join(" e ")}. ${comoResolver.join(" ")}`.trim(),
    };
  }

  const { data: gravado, error } = await supabase
    .from("jobs")
    .update({
      status: "encerrado",
      encerrado_em: new Date().toISOString(),
      encerrado_por: session.profile.id,
    })
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    // Trava de corrida: se o job saiu de `aberto` entre a leitura e o
    // update, nada é gravado.
    .in("status", JOB_STATUS_ABERTO)
    .select("status")
    .maybeSingle<{ status: JobStatus }>();

  if (error) {
    console.error("[job.encerrar]", error.message);
    return { ok: false, message: "Não foi possível enviar o job para encerramento." };
  }
  if (!gravado) {
    return {
      ok: false,
      message: "O job mudou de situação enquanto esta tela estava aberta. Recarregue e confira.",
    };
  }

  await logAuditEvent({
    acao: "job.encerrado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      faturamento: Number(job.faturamento_previsto ?? 0),
      // O gatilho do banco troca `encerrado` por `finalizado` quando todo o
      // faturamento já foi enviado (decisão 094) — e registra `job.finalizado`.
      finalizado: gravado.status === "finalizado",
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath(`/financeiro/jobs/${jobId}`);
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);

  return { ok: true, id: jobId, status: gravado.status };
}
