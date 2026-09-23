"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import {
  PP_STATUS_EM_ABERTO,
  BV_SITUACAO_EM_ABERTO,
  situacaoDaVerba,
  situacaoVerbaLabel,
  verbaPendenteNoEncerramento,
  jobStatusLabel,
  jobEstaAberto,
  JOB_STATUS_ABERTO,
  type JobStatus,
  type SituacaoVerba,
} from "@/lib/types";
import { devolucaoDaVerba, prestacaoDaVerba } from "@/lib/data/prestacao-da-verba";
import { itensSemConclusaoDoJob } from "./realizado/conclusao-item";

export type ActionResult =
  | { ok: true; id: string; status: JobStatus }
  | { ok: false; message: string };

/** O que impede o encerramento agora. Vazio = pode encerrar. */
export interface ImpedimentosEncerramento {
  ppsEmAberto: { codigo: string; status: string }[];
  /** Verbas pagas que ainda não fecharam (decisão 081, pergunta 10a). */
  verbasEmAberto: { codigo: string; situacao: Exclude<SituacaoVerba, "concluida"> }[];
  bvsEmAberto: { item: string; situacao: string }[];
  /** Itens de custo que ainda não disseram se sairá mais PP deles
   *  (decisão 052). Só as linhas de calha PP — A e D não geram PP e não
   *  têm o que marcar. */
  itensSemMarcacao: { item: string }[];
}

/**
 * Levanta os impedimentos do encerramento, para `encerrarJob` refazer a
 * conta antes de gravar. A tela não passa por aqui: o fechamento é montado
 * em `carregar-detalhe.ts`, com os dados que a página já carregou.
 *
 * NÃO EXPORTAR (15/09/2026). Todo export async de arquivo "use server"
 * vira Server Action, chamável pelo navegador com qualquer argumento — e
 * esta recebe `tenantId` confiando em quem chama. O único chamador é
 * `encerrarJob`, que tira o tenant da sessão.
 *
 * Regra do time (13/08/2026): job não encerra com PP ou BV em aberto.
 * "Em aberto" é PP que ainda não foi paga e BV que ainda não foi
 * recebido — cancelada não conta, porque não é compromisso nem desembolso
 * (a rejeitada conta desde a decisão 083).
 *
 * E não encerra com item de custo em aberto (04/09/2026, decisão 052), nem
 * com verba de produção não concluída (decisão 081 §7).
 *
 * ⚠️ O FATURAMENTO SAIU DAQUI em 16/09/2026 (decisão 087). Até então o job
 * só encerrava enviado para faturamento (decisão 008 §1) e sem saldo a
 * faturar (decisão 034), porque o job encerrado sumia da fila de
 * faturamento. Agora a fila e o fluxo de caixa enxergam o job encerrado,
 * faturamento e encerramento correm separados, e o job fica FINALIZADO
 * quando os dois terminam — quem marca é o banco.
 */
async function levantarImpedimentos(
  tenantId: string,
  jobId: string,
): Promise<ImpedimentosEncerramento> {
  const supabase = createClient();

  const [ppsRes, verbasRes, bvsRes, semMarcacaoRes] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select("codigo, status")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .in("status", PP_STATUS_EM_ABERTO),
    // Verba paga sem prestação aprovada (decisão 081, pergunta 10a; o estorno
    // por baixar deixou de travar em 22/09/2026). As dicas de FK
    // são as de `SELECT_PRESTACAO_DA_VERBA` — sem elas o embed é ambíguo.
    supabase
      .from("pedidos_compra")
      .select(
        "codigo, status, verba_producao, " +
          "prestacao:pp_verba_prestacoes!pp_verba_prestacoes_pedido_compra_id_fkey(status, valor_devolvido), " +
          "devolucao:pp_verba_devolucoes!pp_verba_devolucoes_pedido_compra_id_fkey(pago_em)",
      )
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .eq("verba_producao", true)
      .eq("status", "pago"),
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
    // Mesma consulta que o botão "Concluir PPs" da barra usa para saber
    // quem ele vai marcar — o recorte mora num lugar só (decisão 052).
    itensSemConclusaoDoJob(supabase, tenantId, jobId),
  ]);

  return {
    // Leitura que falhou trava a mais, nunca a menos.
    ppsEmAberto: ppsRes.error
      ? [{ codigo: "Pedidos de Produção", status: "gerada" }]
      : ((ppsRes.data ?? []) as any[]).map((p) => ({
          codigo: p.codigo,
          status: p.status,
        })),
    verbasEmAberto: verbasRes.error
      ? [{ codigo: "Verbas de produção", situacao: "aguardando_prestacao" }]
      : ((verbasRes.data ?? []) as any[]).flatMap((pp) => {
          const situacao = situacaoDaVerba({
            verba_producao: pp.verba_producao === true,
            status: pp.status,
            prestacao: prestacaoDaVerba(pp.prestacao),
            devolucao: devolucaoDaVerba(pp.devolucao),
          });
          return verbaPendenteNoEncerramento(situacao)
            ? [{ codigo: pp.codigo as string, situacao }]
            : [];
        }),
    bvsEmAberto: bvsRes.error
      ? [{ item: "BVs", situacao: "confirmado" }]
      : ((bvsRes.data ?? []) as any[]).map((b) => ({
          item: b.copia?.item ?? "Item",
          situacao: b.situacao,
        })),
    itensSemMarcacao: semMarcacaoRes.map((i) => ({ item: i.nome })),
  };
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
    .select("id, status, projeto_id, orcamento_id, faturamento_previsto")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: JobStatus;
      projeto_id: string;
      orcamento_id: string;
      faturamento_previsto: number | string | null;
    }>();

  if (!job) return { ok: false, message: "Job não encontrado." };

  if (!jobEstaAberto(job.status)) {
    return {
      ok: false,
      message: `Só job aberto pode ser enviado para encerramento. Este está ${jobStatusLabel(job.status).toLowerCase()}.`,
    };
  }

  const imp = await levantarImpedimentos(session.activeTenant.id, jobId);

  if (
    imp.ppsEmAberto.length > 0 ||
    imp.verbasEmAberto.length > 0 ||
    imp.bvsEmAberto.length > 0 ||
    imp.itensSemMarcacao.length > 0
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
