"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { pode } from "@/lib/permissoes";

/**
 * O "Salvar" do pop-up Equipe do job de pagamentos (decisão 282), pelo
 * módulo Jobs e pelo Financeiro.
 *
 * Quem muda: o administrador, o financeiro, os GPs e os produtores
 * (`jobs.editar_equipe_de_pagamentos`) e quem criou o job. O banco confere
 * de novo, grava a equipe e a chave "Envia PP" de cada produtor e refaz a
 * equipe do projeto escondido (`salvar_equipe_do_job_de_pagamentos`).
 */

const entradaSchema = z.object({
  jobId: z.string().uuid(),
  membros: z
    .array(z.object({ profileId: z.string().uuid(), enviaPP: z.boolean() }))
    .max(200),
});

export type EntradaDaEquipeDePagamentos = z.infer<typeof entradaSchema>;
export type ResultadoDaEquipeDePagamentos = { ok: true } | { ok: false; message: string };

/** Mensagem do banco sem o prefixo técnico; a genérica quando não há uma. */
function mensagemDoBanco(msg: string | undefined, padrao: string) {
  const limpa = (msg ?? "").replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
  return limpa && !/[_"]/.test(limpa) ? limpa : padrao;
}

export async function salvarEquipeDoJobDePagamentos(
  entrada: EntradaDaEquipeDePagamentos,
): Promise<ResultadoDaEquipeDePagamentos> {
  const parsed = entradaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, message: "Dados da equipe inválidos. Recarregue a página." };
  }
  const { jobId } = parsed.data;
  // Uma linha por pessoa (a última marcação vale).
  const membros = Array.from(
    new Map(parsed.data.membros.map((m) => [m.profileId, m])).values(),
  );

  const session = await requireSession();
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const [jobRes, antesRes, membrosRes] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, codigo, created_by, de_pagamentos")
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; codigo: string; created_by: string | null; de_pagamentos: boolean }>(),
    supabase
      .from("jobs_equipe_de_pagamentos")
      .select("profile_id, envia_pp")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    supabase.rpc("membros_ativos_com_papel", { p_tenant_id: tenantId }),
  ]);
  const job = jobRes.data;
  if (!job || job.de_pagamentos !== true) {
    return { ok: false, message: "Job de pagamentos não encontrado. Recarregue a página." };
  }
  const podeMudar =
    pode(session.activeRole, "jobs.editar_equipe_de_pagamentos") ||
    job.created_by === session.profile.id;
  if (!podeMudar) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        acao_tentada: "job.equipe_de_pagamentos_alterada",
        motivo: "papel_sem_permissao",
        papel: session.activeRole,
      },
    });
    return { ok: false, message: "Seu papel não muda a equipe deste job." };
  }

  const { error } = await supabase.rpc("salvar_equipe_do_job_de_pagamentos", {
    p_job_id: jobId,
    p_membros: membros.map((m) => ({ profile_id: m.profileId, envia_pp: m.enviaPP })),
  });
  if (error) {
    console.error("[equipe-pagamentos.salvar]", error.message);
    return {
      ok: false,
      message: mensagemDoBanco(error.message, "Não foi possível salvar a equipe. Tente de novo."),
    };
  }

  // A auditoria compara com o que estava gravado; a chave vale como o banco
  // gravou (só fica ligada para quem é produtor).
  const depoisRes = await supabase
    .from("jobs_equipe_de_pagamentos")
    .select("profile_id, envia_pp")
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId);
  const antes = new Map(
    ((antesRes.data ?? []) as Array<{ profile_id: string; envia_pp: boolean }>).map((l) => [l.profile_id, l.envia_pp]),
  );
  const depois = new Map(
    ((depoisRes.data ?? []) as Array<{ profile_id: string; envia_pp: boolean }>).map((l) => [l.profile_id, l.envia_pp]),
  );
  const nomes = new Map(
    ((membrosRes.data ?? []) as Array<{ id: string; nome: string }>).map((m) => [m.id, m.nome]),
  );
  const pessoa = (id: string) => ({ id, nome: nomes.get(id) ?? null });
  const entraram = [...depois.keys()].filter((id) => !antes.has(id));
  const sairam = [...antes.keys()].filter((id) => !depois.has(id));
  const ligaram = [...depois.entries()].filter(([id, v]) => v && antes.get(id) !== true).map(([id]) => id);
  const desligaram = [...antes.entries()]
    .filter(([id, v]) => v && depois.has(id) && depois.get(id) !== true)
    .map(([id]) => id);

  if (entraram.length + sairam.length + ligaram.length + desligaram.length > 0) {
    await logAuditEvent({
      acao: "job.equipe_de_pagamentos_alterada",
      tenantId,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        decisao: "282",
        job_codigo: job.codigo,
        entraram: entraram.map(pessoa),
        sairam: sairam.map(pessoa),
        envia_pp_ligado: ligaram.map(pessoa),
        envia_pp_desligado: desligaram.map(pessoa),
      },
    });
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/financeiro/jobs/${jobId}`);
  return { ok: true };
}
