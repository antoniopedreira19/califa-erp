"use server";

/**
 * Pagamentos atrasados em job encerrado ou finalizado (decisão 259).
 *
 * As regras moram nas funções do banco (migration 20261116600001): quem pode,
 * o job fechado, uma liberação por vez, o motivo, as pendências que impedem
 * concluir. Aqui ficam a sessão, a permissão da tela, a auditoria e o
 * revalidate das páginas do job.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";

type Resultado = { ok: true } | { ok: false; message: string };

export interface ConclusaoDosPagamentosAtrasados {
  /** PPs de pagamento atrasado (não canceladas) e a soma delas. */
  pps: number;
  valor: number;
  /** Linhas vermelhas criadas na liberação. */
  linhas: number;
  /** O que impede concluir (PP gerada sem envio, PP a emitir, linha
   *  vermelha sem PP). Vazio: dá para concluir. */
  pendencias: string[];
}

const liberarSchema = z.object({
  trimestre: z.number().int().min(1).max(4),
  ano: z.number().int().min(2020).max(2100),
  motivo: z.string().trim().min(1, "Escreva o motivo dos pagamentos atrasados.").max(500),
});

function revalidar(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/financeiro/jobs/${jobId}`);
}

/** A mensagem do banco (a das funções, em português) ou a padrão. */
function mensagem(error: { message?: string; code?: string } | null, padrao: string): string {
  return error?.code === "P0001" && error.message ? error.message : padrao;
}

/** O financeiro libera os pagamentos atrasados no job fechado. */
export async function liberarPagamentosAtrasados(
  jobId: string,
  dados: z.input<typeof liberarSchema>,
): Promise<Resultado> {
  const session = await requireSession();
  const perm = await checarPermissao(session, "jobs.editar_orcado_financeiro", {
    acao_tentada: "pagamentos_atrasados.liberados",
    job_id: jobId,
  });
  if (!perm.ok) return { ok: false, message: "Só o financeiro ou o administrador libera pagamentos atrasados." };
  const parsed = liberarSchema.safeParse(dados);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Confira a competência e o motivo." };
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("liberar_pagamentos_atrasados", {
    p_job_id: jobId,
    p_trimestre: parsed.data.trimestre,
    p_ano: parsed.data.ano,
    p_motivo: parsed.data.motivo,
  });
  if (error) {
    console.error("[pagamentos_atrasados.liberar]", error.message);
    return { ok: false, message: mensagem(error, "Não foi possível liberar os pagamentos atrasados.") };
  }
  await logAuditEvent({
    acao: "pagamentos_atrasados.liberados",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      liberacao_id: data,
      competencia: `${parsed.data.trimestre}T/${parsed.data.ano}`,
      motivo: parsed.data.motivo,
    },
  });
  revalidar(jobId);
  return { ok: true };
}

/** A produção conclui: a liberação espera o financeiro confirmar. */
export async function pedirConclusaoDosPagamentosAtrasados(jobId: string): Promise<Resultado> {
  const session = await requireSession();
  const perm = await checarPermissao(session, "jobs.preparar_errata", {
    acao_tentada: "pagamentos_atrasados.conclusao_pedida",
    job_id: jobId,
  });
  if (!perm.ok) return { ok: false, message: "Só o administrador, o GP ou o produtor conclui os pagamentos atrasados." };

  const supabase = createClient();
  const { error } = await supabase.rpc("pedir_conclusao_dos_pagamentos_atrasados", { p_job_id: jobId });
  if (error) {
    console.error("[pagamentos_atrasados.pedir_conclusao]", error.message);
    return { ok: false, message: mensagem(error, "Não foi possível concluir os pagamentos atrasados.") };
  }
  await logAuditEvent({
    acao: "pagamentos_atrasados.conclusao_pedida",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
  });
  revalidar(jobId);
  return { ok: true };
}

/** A produção desiste da conclusão enquanto o financeiro não confirmou. */
export async function cancelarConclusaoDosPagamentosAtrasados(jobId: string): Promise<Resultado> {
  const session = await requireSession();
  const perm = await checarPermissao(session, "jobs.preparar_errata", {
    acao_tentada: "pagamentos_atrasados.conclusao_cancelada",
    job_id: jobId,
  });
  if (!perm.ok) return { ok: false, message: "Só o administrador, o GP ou o produtor cancela a conclusão." };

  const supabase = createClient();
  const { error } = await supabase.rpc("cancelar_conclusao_dos_pagamentos_atrasados", { p_job_id: jobId });
  if (error) {
    console.error("[pagamentos_atrasados.cancelar_conclusao]", error.message);
    return { ok: false, message: mensagem(error, "Não foi possível cancelar a conclusão.") };
  }
  await logAuditEvent({
    acao: "pagamentos_atrasados.conclusao_cancelada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
  });
  revalidar(jobId);
  return { ok: true };
}

/** O financeiro conclui (confirmando a produção ou sozinho): a planilha
 *  volta a travar. */
export async function concluirPagamentosAtrasados(jobId: string): Promise<Resultado> {
  const session = await requireSession();
  const perm = await checarPermissao(session, "jobs.editar_orcado_financeiro", {
    acao_tentada: "pagamentos_atrasados.concluidos",
    job_id: jobId,
  });
  if (!perm.ok) return { ok: false, message: "Só o financeiro ou o administrador conclui os pagamentos atrasados." };

  const supabase = createClient();
  const { data: antes } = await supabase
    .from("jobs_pagamentos_atrasados")
    .select("id, conclusao_pedida_em")
    .eq("job_id", jobId)
    .is("encerrado_em", null)
    .maybeSingle();
  const { error } = await supabase.rpc("concluir_pagamentos_atrasados", { p_job_id: jobId });
  if (error) {
    console.error("[pagamentos_atrasados.concluir]", error.message);
    return { ok: false, message: mensagem(error, "Não foi possível concluir os pagamentos atrasados.") };
  }
  await logAuditEvent({
    acao: "pagamentos_atrasados.concluidos",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      liberacao_id: antes?.id ?? null,
      confirmando_a_producao: Boolean(antes?.conclusao_pedida_em),
    },
  });
  revalidar(jobId);
  return { ok: true };
}

/** O resumo do que a liberação lançou e as pendências, para o diálogo de
 *  concluir (lido na hora de abrir). */
export async function lerConclusaoDosPagamentosAtrasados(
  jobId: string,
): Promise<{ ok: true; dados: ConclusaoDosPagamentosAtrasados } | { ok: false; message: string }> {
  await requireSession();
  const supabase = createClient();
  const { data: lib, error: libErr } = await supabase
    .from("jobs_pagamentos_atrasados")
    .select("id")
    .eq("job_id", jobId)
    .is("encerrado_em", null)
    .maybeSingle();
  if (libErr || !lib) return { ok: false, message: "Não há pagamentos atrasados liberados neste job." };

  const [ppsRes, linhasRes, pendRes] = await Promise.all([
    supabase.from("pedidos_compra").select("valor").eq("pagamento_atrasado_id", lib.id).neq("status", "cancelada"),
    supabase
      .from("jobs_itens_orcado")
      .select("id", { count: "exact", head: true })
      .eq("pagamento_atrasado_id", lib.id)
      .is("cancelada_em", null),
    supabase.rpc("pendencias_dos_pagamentos_atrasados", { p_liberacao_id: lib.id }),
  ]);
  if (ppsRes.error || linhasRes.error || pendRes.error) {
    return { ok: false, message: "Não foi possível ler o que foi lançado na liberação." };
  }
  const pps = (ppsRes.data ?? []) as Array<{ valor: number | string }>;
  return {
    ok: true,
    dados: {
      pps: pps.length,
      valor: Math.round(pps.reduce((s, p) => s + Number(p.valor), 0) * 100) / 100,
      linhas: linhasRes.count ?? 0,
      pendencias: ((pendRes.data ?? []) as string[]).filter(Boolean),
    },
  };
}
