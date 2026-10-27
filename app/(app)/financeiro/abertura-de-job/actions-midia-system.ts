"use server";

/**
 * "Liberar NFs" do job Mídia System (decisão 216): o financeiro diz que a
 * auditoria do cliente terminou. As PPs que foram sem NF entram na
 * prestação de contas, e as próximas voltam a exigir a NF no envio.
 *
 * A função do banco (`liberar_nfs_midia_system`) confere o papel, o job e
 * se já não foi liberado; aqui ficam a auditoria e a revalidação das telas.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";

export type ResultadoDaLiberacao = { ok: true; pps: number } | { ok: false; message: string };

export async function liberarNfsMidiaSystem(jobId: string): Promise<ResultadoDaLiberacao> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.abrir_financeiro");
  if (!gate.ok) return { ok: false, message: gate.message };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("liberar_nfs_midia_system", { p_job_id: jobId });
  if (error) {
    console.error("[midia-system.liberar]", error.message);
    const limpa = error.message.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
    return {
      ok: false,
      message: limpa && !/[_"]/.test(limpa) ? limpa : "Não foi possível liberar as NFs. Tente de novo.",
    };
  }
  const pps = Number(data ?? 0);

  await logAuditEvent({
    acao: "job.midia_system_nfs_liberadas",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: { pps_na_prestacao: pps },
  });

  revalidatePath(`/financeiro/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, pps };
}
