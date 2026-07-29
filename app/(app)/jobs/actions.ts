"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { jobSchema, rejeicaoAberturaSchema } from "@/lib/validations/jobs";
import { gerarCodigoJob } from "@/lib/codigos/jobs";
import { JOB_STATUS_TRANSICOES, type JobStatus } from "@/lib/types";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  const posicaoRaw = formData.get("posicao_hierarquia")?.toString();
  const paiRaw = formData.get("job_pai_id")?.toString();
  const valorRaw = formData.get("valor_total")?.toString();
  return {
    nome: formData.get("nome")?.toString() ?? "",
    produto: formData.get("produto")?.toString() ?? "",
    regional_id: formData.get("regional_id")?.toString() ?? "",
    cidade: formData.get("cidade")?.toString() ?? "",
    data_inicio_prevista: formData.get("data_inicio_prevista")?.toString() ?? "",
    data_fim_prevista: formData.get("data_fim_prevista")?.toString() ?? "",
    responsavel_id: formData.get("responsavel_id")?.toString() ?? "",
    valor_total: valorRaw && valorRaw.length > 0 ? Number(valorRaw) : null,
    posicao_hierarquia:
      posicaoRaw === "principal" || posicaoRaw === "sub_job" ? posicaoRaw : undefined,
    job_pai_id: paiRaw ?? "",
  };
}

function mapJobDbError(msg: string): string {
  if (msg.includes("uniq_jobs_codigo_por_tenant")) return "Já existe um job com este código.";
  if (msg.includes("uniq_jobs_por_orcamento_ativo")) return "Este orçamento já tem um job ativo.";
  if (msg.includes("uniq_jobs_principal_por_projeto")) return "Já existe um job principal neste projeto.";
  if (msg.includes("jobs_datas_ordem")) return "Data fim precisa ser igual ou posterior à data início.";
  return "Não foi possível salvar o job.";
}

export async function criarJob(
  orcamentoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = jobSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  // 1. Fetch orçamento (deve estar 'aprovado' + tem versao_aprovada_id)
  const { data: orc } = await supabase
    .from("orcamentos")
    .select("id, status, versao_aprovada_id, projeto_id")
    .eq("id", orcamentoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: string;
      versao_aprovada_id: string | null;
      projeto_id: string;
    }>();

  if (!orc) return { ok: false, message: "Orçamento não encontrado." };
  if (orc.status !== "aprovado" || !orc.versao_aprovada_id) {
    return { ok: false, message: "Orçamento não está aprovado." };
  }

  // 2. Verifica se já existe job ativo pra este orçamento (fail early)
  const { count: jobsDoOrcamento } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("orcamento_id", orcamentoId)
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "cancelado");

  if ((jobsDoOrcamento ?? 0) > 0) {
    return { ok: false, message: "Este orçamento já tem um job ativo." };
  }

  // 3. Fetch jobs ativos do projeto pra validar hierarquia
  const { data: jobsProjeto } = await supabase
    .from("jobs")
    .select("id, job_pai_id, status")
    .eq("projeto_id", orc.projeto_id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "cancelado");

  const jobsAtivos = jobsProjeto ?? [];
  const principalAtual = jobsAtivos.find((j) => j.job_pai_id === null);

  if (jobsAtivos.length > 0 && !parsed.data.posicao_hierarquia) {
    return {
      ok: false,
      message: "Escolha se este job será principal ou sub-job.",
    };
  }

  // 4. Determina job_pai_id baseado em posicao_hierarquia
  let jobPaiId: string | null = null;
  if (jobsAtivos.length > 0) {
    if (parsed.data.posicao_hierarquia === "sub_job") {
      if (!principalAtual) {
        return { ok: false, message: "Não há principal no projeto — este job precisa ser principal." };
      }
      jobPaiId = principalAtual.id;
    }
    // Se posicao='principal', jobPaiId fica null; o principal atual será re-vinculado no swap abaixo
  }

  // 5. Gera código
  let codigo: string;
  try {
    codigo = await gerarCodigoJob(supabase, session.activeTenant.id);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  // 6. Insert do novo job. Se posicao='principal' e já existe principal, precisa swap.
  //    Estratégia: insert nasce como sub-job do principal atual (satisfaz unique),
  //    depois flipa (update principal atual pra apontar pro novo, update novo pra null).
  const nasceComoSubJob =
    parsed.data.posicao_hierarquia === "principal" && principalAtual;

  const insertPayload = {
    tenant_id: session.activeTenant.id,
    codigo,
    projeto_id: orc.projeto_id,
    orcamento_id: orcamentoId,
    versao_orcamento_aprovada_id: orc.versao_aprovada_id,
    nome: parsed.data.nome,
    produto: parsed.data.produto,
    regional_id: parsed.data.regional_id,
    cidade: parsed.data.cidade,
    data_inicio_prevista: parsed.data.data_inicio_prevista,
    data_fim_prevista: parsed.data.data_fim_prevista,
    responsavel_id: parsed.data.responsavel_id,
    valor_total: parsed.data.valor_total,
    job_pai_id: nasceComoSubJob ? principalAtual!.id : jobPaiId,
    // status default do banco = 'aguardando_abertura' — não sobrescreva
    created_by: session.profile.id,
  };

  const { data: novo, error: errIns } = await supabase
    .from("jobs")
    .insert(insertPayload)
    .select("id")
    .single();

  if (errIns) {
    console.error("[jobs.criar]", errIns.message);
    return { ok: false, message: mapJobDbError(errIns.message) };
  }

  // 7. Se nasceu como sub-job só pra virar principal, faz o swap
  if (nasceComoSubJob && principalAtual) {
    // Update principal atual: aponta pro novo
    const { error: errSwap1 } = await supabase
      .from("jobs")
      .update({ job_pai_id: novo.id })
      .eq("id", principalAtual.id)
      .eq("tenant_id", session.activeTenant.id);

    if (errSwap1) {
      console.error("[jobs.criar.swap1]", errSwap1.message);
      return {
        ok: false,
        message: "Job criado mas swap de hierarquia falhou. Verifique manualmente.",
      };
    }

    // Update novo: vira principal (job_pai_id = null)
    const { error: errSwap2 } = await supabase
      .from("jobs")
      .update({ job_pai_id: null })
      .eq("id", novo.id)
      .eq("tenant_id", session.activeTenant.id);

    if (errSwap2) {
      console.error("[jobs.criar.swap2]", errSwap2.message);
      return {
        ok: false,
        message: "Job criado mas swap de hierarquia falhou. Verifique manualmente.",
      };
    }
  }

  // 8. Update orçamento: status = 'job_criado'
  const { error: errOrc } = await supabase
    .from("orcamentos")
    .update({ status: "job_criado" })
    .eq("id", orcamentoId)
    .eq("tenant_id", session.activeTenant.id);

  if (errOrc) {
    console.error("[jobs.criar.orc_status]", errOrc.message);
    // não bloqueia — job foi criado; log e segue
  }

  await logAuditEvent({
    acao: "job.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: novo.id,
    metadata: {
      codigo,
      orcamento_id: orcamentoId,
      projeto_id: orc.projeto_id,
      posicao: parsed.data.posicao_hierarquia ?? "principal",
    },
  });

  revalidatePath(`/orcamentos/${orc.projeto_id}`);
  revalidatePath(`/orcamentos/${orc.projeto_id}/${orcamentoId}`);
  revalidatePath("/jobs");
  return { ok: true, id: novo.id };
}

export async function atualizarJob(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = jobSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

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
      valor_total: parsed.data.valor_total,
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

export async function atualizarHierarquiaJob(
  id: string,
  novoPapel: "principal" | "sub_job",
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  // Fetch job atual + projeto_id + status
  const { data: job } = await supabase
    .from("jobs")
    .select("id, projeto_id, job_pai_id, status")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; projeto_id: string; job_pai_id: string | null; status: string }>();

  if (!job) return { ok: false, message: "Job não encontrado." };
  if (job.status === "cancelado") {
    return { ok: false, message: "Job cancelado não pode mudar de hierarquia." };
  }

  const jaEhPrincipal = job.job_pai_id === null;
  if (novoPapel === "principal" && jaEhPrincipal) {
    return { ok: true, id }; // no-op
  }
  if (novoPapel === "sub_job" && !jaEhPrincipal) {
    return { ok: true, id }; // já é sub-job
  }

  // Fetch outros jobs ativos do projeto
  const { data: outros } = await supabase
    .from("jobs")
    .select("id, job_pai_id")
    .eq("projeto_id", job.projeto_id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("id", id)
    .neq("status", "cancelado");

  const outrosAtivos = outros ?? [];

  if (novoPapel === "sub_job") {
    // Preciso encontrar o principal atual (que não seja este)
    const principal = outrosAtivos.find((j) => j.job_pai_id === null);
    if (!principal) {
      return {
        ok: false,
        message: "Este é o único job do projeto — não pode virar sub-job.",
      };
    }
    const { error } = await supabase
      .from("jobs")
      .update({ job_pai_id: principal.id })
      .eq("id", id)
      .eq("tenant_id", session.activeTenant.id);
    if (error) {
      console.error("[jobs.hierarquia.sub_job]", error.message);
      return { ok: false, message: mapJobDbError(error.message) };
    }
  } else {
    // novoPapel === "principal", e este job era sub-job
    const principalAtual = outrosAtivos.find((j) => j.job_pai_id === null);
    if (!principalAtual) {
      // Não existe principal atualmente — só vira principal, sem swap
      const { error } = await supabase
        .from("jobs")
        .update({ job_pai_id: null })
        .eq("id", id)
        .eq("tenant_id", session.activeTenant.id);
      if (error) {
        console.error("[jobs.hierarquia.principal.simples]", error.message);
        return { ok: false, message: mapJobDbError(error.message) };
      }
    } else {
      // Swap atômico: primeiro update principal atual pra apontar pra este;
      // depois update este pra job_pai_id = null
      const { error: err1 } = await supabase
        .from("jobs")
        .update({ job_pai_id: id })
        .eq("id", principalAtual.id)
        .eq("tenant_id", session.activeTenant.id);
      if (err1) {
        console.error("[jobs.hierarquia.swap1]", err1.message);
        return { ok: false, message: mapJobDbError(err1.message) };
      }

      const { error: err2 } = await supabase
        .from("jobs")
        .update({ job_pai_id: null })
        .eq("id", id)
        .eq("tenant_id", session.activeTenant.id);
      if (err2) {
        console.error("[jobs.hierarquia.swap2]", err2.message);
        return { ok: false, message: mapJobDbError(err2.message) };
      }
    }
  }

  await logAuditEvent({
    acao: "job.hierarquia_alterada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: id,
    metadata: { novo_papel: novoPapel },
  });

  revalidatePath(`/jobs/${id}`);
  revalidatePath(`/orcamentos/${job.projeto_id}`);
  return { ok: true, id };
}

export async function atualizarStatusJob(
  id: string,
  novoStatus: JobStatus,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, projeto_id, orcamento_id, job_pai_id")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: JobStatus;
      projeto_id: string;
      orcamento_id: string;
      job_pai_id: string | null;
    }>();

  if (!job) return { ok: false, message: "Job não encontrado." };

  const transicoesValidas = JOB_STATUS_TRANSICOES[job.status];
  if (!transicoesValidas.includes(novoStatus)) {
    return {
      ok: false,
      message: `Transição inválida: ${job.status} → ${novoStatus}.`,
    };
  }

  // Se está cancelando o principal e existem sub-jobs ativos, bloqueia
  if (novoStatus === "cancelado" && job.job_pai_id === null) {
    const { count: subJobs } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("projeto_id", job.projeto_id)
      .eq("job_pai_id", job.id)
      .neq("status", "cancelado");
    if ((subJobs ?? 0) > 0) {
      return {
        ok: false,
        message: "Cancele ou transfira os sub-jobs antes de cancelar o principal.",
      };
    }
  }

  const { error } = await supabase
    .from("jobs")
    .update({ status: novoStatus })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[jobs.status]", error.message);
    return { ok: false, message: mapJobDbError(error.message) };
  }

  await logAuditEvent({
    acao: "job.status_alterado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: id,
    metadata: { de: job.status, para: novoStatus },
  });

  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  revalidatePath(`/orcamentos/${job.projeto_id}`);
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);
  return { ok: true, id };
}

export async function aprovarAberturaJob(jobId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: { action: "job.aprovarAbertura", role: session.activeRole },
    });
    return { ok: false, message: "Só administrador ou financeiro pode aprovar aberturas de job." };
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
    return { ok: false, message: `Job está em status ${job.status} — não é aprovável.` };
  }

  const { error } = await supabase
    .from("jobs")
    .update({ status: "aberto", motivo_rejeicao: null })
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[jobs.aprovarAbertura]", error.message);
    return { ok: false, message: mapJobDbError(error.message) };
  }

  await logAuditEvent({
    acao: "job.abertura_aprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/jobs-aguardando-abertura");
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);
  return { ok: true, id: jobId };
}

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
  revalidatePath("/financeiro/jobs-aguardando-abertura");
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);
  return { ok: true, id: jobId };
}

export async function reenviarJobParaAprovacao(jobId: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, projeto_id, orcamento_id")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; status: JobStatus; projeto_id: string; orcamento_id: string }>();

  if (!job) return { ok: false, message: "Job não encontrado." };
  if (job.status !== "rejeitado_financeiro") {
    return { ok: false, message: "Só jobs rejeitados podem ser reenviados." };
  }

  const { error } = await supabase
    .from("jobs")
    .update({
      status: "aguardando_abertura",
      motivo_rejeicao: null,
    })
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[jobs.reenviar]", error.message);
    return { ok: false, message: mapJobDbError(error.message) };
  }

  await logAuditEvent({
    acao: "job.reenviado_para_aprovacao",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/jobs-aguardando-abertura");
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);
  return { ok: true, id: jobId };
}
