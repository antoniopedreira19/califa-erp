"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  envioFaturamentoSchema,
  type EnvioFaturamentoInput,
} from "@/lib/validations/envio-faturamento";
import type { JobStatus } from "@/lib/types";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * A produção libera o job para o financeiro faturar.
 *
 * A partir daqui o job entra na fila de faturamento
 * (`vw_faturamento_pendente`), levando junto o que só a produção sabe:
 * número da PO, CNAE a usar, portal do cliente e o vencimento acordado.
 *
 * O valor NÃO vem do formulário — é relido de `jobs.faturamento_previsto`
 * aqui dentro. É valor de nota fiscal; o navegador não é fonte confiável
 * para ele. O que o formulário mostra é uma leitura travada do mesmo
 * número.
 */
export async function enviarJobParaFaturamento(
  jobId: string,
  input: EnvioFaturamentoInput,
): Promise<ActionResult> {
  const session = await requireSession();

  const parsed = envioFaturamentoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, status, faturamento_previsto, projeto_id, orcamento_id, projeto:projetos(cliente_id)",
    )
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: JobStatus;
      faturamento_previsto: number | string | null;
      projeto_id: string;
      orcamento_id: string;
      projeto: { cliente_id: string } | null;
    }>();

  if (!job) return { ok: false, message: "Job não encontrado." };

  if (job.status !== "aberto") {
    return {
      ok: false,
      message:
        "Só job aberto pode ser enviado para faturamento. Este está em " +
        `${job.status}.`,
    };
  }

  const valor = Number(job.faturamento_previsto ?? 0);
  if (!(valor > 0)) {
    return {
      ok: false,
      message:
        "Este job está sem faturamento previsto — não há valor a faturar.",
    };
  }

  // Envio é único por job (unique em job_id). Conferir antes devolve
  // mensagem legível em vez de erro de constraint.
  const { data: jaEnviado } = await supabase
    .from("jobs_envio_faturamento")
    .select("id")
    .eq("job_id", jobId)
    .maybeSingle<{ id: string }>();

  if (jaEnviado) {
    return {
      ok: false,
      message: "Este job já foi enviado para faturamento.",
    };
  }

  // O portal precisa ser do cliente DESTE job — a lista do formulário não
  // é garantia. Guardamos também a URL, porque o cadastro pode mudar
  // depois e o registro do envio precisa continuar dizendo para onde a
  // nota devia ir.
  let portalUrl: string | null = null;
  if (parsed.data.portal_id) {
    const { data: portal } = await supabase
      .from("cliente_portais")
      .select("id, url, cliente_id, ativo")
      .eq("id", parsed.data.portal_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{
        id: string;
        url: string;
        cliente_id: string;
        ativo: boolean;
      }>();

    if (!portal || portal.cliente_id !== job.projeto?.cliente_id) {
      return { ok: false, message: "Portal inválido para este cliente." };
    }
    portalUrl = portal.url;
  }

  const { data: novo, error } = await supabase
    .from("jobs_envio_faturamento")
    .insert({
      tenant_id: session.activeTenant.id,
      job_id: jobId,
      valor_faturado: valor,
      numero_po: parsed.data.numero_po,
      data_faturamento: parsed.data.data_faturamento,
      cnae: parsed.data.cnae,
      portal_id: parsed.data.portal_id,
      portal_url: portalUrl,
      enviado_por: session.profile.id,
    })
    .select("id")
    .single();

  if (error || !novo) {
    console.error("[job.enviarFaturamento]", error?.message);
    return {
      ok: false,
      message: "Não foi possível enviar o job para faturamento.",
    };
  }

  await logAuditEvent({
    acao: "job.enviado_para_faturamento",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      valor_faturado: valor,
      data_faturamento: parsed.data.data_faturamento,
      cnae: parsed.data.cnae,
      tem_po: parsed.data.numero_po !== null,
      tem_portal: parsed.data.portal_id !== null,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/jobs/${jobId}`);
  revalidatePath("/financeiro/contas-a-receber");

  return { ok: true, id: novo.id };
}
