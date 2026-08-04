"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { areaDoPapel } from "@/lib/types";

type Ok = { ok: true };
type Err = { ok: false; message: string };
type Result = Ok | Err;

const textoSchema = z
  .string()
  .trim()
  .min(1, "Escreva alguma coisa antes de enviar.")
  .max(2000, "Mensagem passa de 2000 caracteres.");

export async function enviarMensagem(
  jobId: string,
  texto: string,
): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();

  const parsed = textoSchema.safeParse(texto);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Mensagem inválida.",
    };
  }

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, status")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (jobErr || !job) return { ok: false, message: "Job não encontrado." };

  const { error } = await supabase.from("jobs_mensagens").insert({
    tenant_id: session.activeTenant.id,
    job_id: jobId,
    autor_id: session.profile.id,
    area: areaDoPapel(session.activeRole),
    texto: parsed.data,
  });

  if (error) {
    console.error("[chat.enviar]", error.message);
    return { ok: false, message: "Falha ao enviar a mensagem." };
  }

  // Quem escreveu obviamente leu tudo até aqui.
  await marcarChatLido(jobId);

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Zera o contador de não lidas deste usuário neste job. */
export async function marcarChatLido(jobId: string): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase.from("jobs_chat_leituras").upsert(
    {
      tenant_id: session.activeTenant.id,
      job_id: jobId,
      profile_id: session.profile.id,
      lida_ate: new Date().toISOString(),
    },
    { onConflict: "job_id,profile_id" },
  );

  if (error) {
    console.error("[chat.marcar_lido]", error.message);
    return { ok: false, message: "Falha ao marcar como lido." };
  }

  return { ok: true };
}
