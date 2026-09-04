"use server";

/**
 * Marcar e reabrir o item — as duas ações do painel "Destrinchar
 * realizado" (decisão 052).
 *
 * A gravação em si mora em `conclusao-item.ts`, compartilhada com o
 * formulário da PP. Aqui ficam os portões: sessão, tenant, job em estado
 * que aceita ação de planilha, e o nome do item para o chat.
 *
 * Quem pode: qualquer pessoa com acesso ao job (decisão do Tiago,
 * 04/09/2026). Diferente de gerar PP, que exige o responsável do job ou
 * um administrador — marcar não cria compromisso de pagamento, só declara
 * que não sairá mais PP daquele item. A RLS de `jobs_itens_realizado`
 * continua sendo o piso: freelancer só alcança job do projeto dele.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { jobAceitaAcoesPlanilha, type JobStatus } from "@/lib/types";
import { aplicarConclusaoDoItem } from "./conclusao-item";

type Result = { ok: true } | { ok: false; message: string };

async function gate(itemRealizadoId: string) {
  const session = await requireSession();
  const supabase = createClient();

  const { data: item, error } = await supabase
    .from("jobs_itens_realizado")
    .select("id, job_id, job_item_orcado_id")
    .eq("id", itemRealizadoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      job_id: string;
      job_item_orcado_id: string | null;
    }>();

  if (error || !item) {
    return { ok: false as const, message: "Item não encontrado." };
  }

  const [{ data: job }, { data: orcado }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, status")
      .eq("id", item.job_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{ id: string; status: JobStatus }>(),
    item.job_item_orcado_id
      ? supabase
          .from("jobs_itens_orcado")
          .select("item")
          .eq("id", item.job_item_orcado_id)
          .eq("tenant_id", session.activeTenant.id)
          .maybeSingle<{ item: string }>()
      : Promise.resolve({ data: null as { item: string } | null }),
  ]);

  if (!job) return { ok: false as const, message: "Job não encontrado." };

  if (!jobAceitaAcoesPlanilha(job.status)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job_item_realizado",
      entidadeId: itemRealizadoId,
      metadata: {
        acao_tentada: "item_realizado.pps_concluidas",
        motivo: "status_bloqueia_edicao",
        status_atual: job.status,
      },
    });
    return {
      ok: false as const,
      message:
        "O item só pode ser marcado com o job em 'Aberto' ou 'Em produção'.",
    };
  }

  return {
    ok: true as const,
    session,
    supabase,
    jobId: item.job_id,
    itemNome: orcado?.item ?? "Item",
  };
}

/** "Todas as PPs deste item já foram geradas" — o botão do painel. */
export async function marcarPPsConcluidasDoItem(
  itemRealizadoId: string,
): Promise<Result> {
  const g = await gate(itemRealizadoId);
  if (!g.ok) return g;

  const res = await aplicarConclusaoDoItem(g.supabase, {
    tenantId: g.session.activeTenant.id,
    jobId: g.jobId,
    itemRealizadoId,
    profileId: g.session.profile.id,
    papel: g.session.activeRole,
    itemNome: g.itemNome,
    concluido: true,
    origem: "painel",
  });
  if (!res.ok) return res;

  revalidatePath(`/jobs/${g.jobId}`);
  return { ok: true };
}

/**
 * Reabre o item para gerar mais uma PP.
 *
 * Não existe botão "Reabrir": este é o "Sim, gerar nova PP" do aviso que
 * aparece quando alguém pede uma PP num item já marcado. A reabertura
 * acontece aqui, ANTES de o formulário abrir — se a pessoa desistir no
 * meio do formulário, o item fica reaberto, o que é a leitura correta:
 * ela declarou que ainda falta PP.
 */
export async function reabrirItemParaNovaPP(
  itemRealizadoId: string,
): Promise<Result> {
  const g = await gate(itemRealizadoId);
  if (!g.ok) return g;

  const res = await aplicarConclusaoDoItem(g.supabase, {
    tenantId: g.session.activeTenant.id,
    jobId: g.jobId,
    itemRealizadoId,
    profileId: g.session.profile.id,
    papel: g.session.activeRole,
    itemNome: g.itemNome,
    concluido: false,
    origem: "nova_pp",
  });
  if (!res.ok) return res;

  revalidatePath(`/jobs/${g.jobId}`);
  return { ok: true };
}
