"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import type { JobItemRealizado } from "@/lib/types";

export type CampoRealizado =
  | "valor_unitario_realizado"
  | "quantidade_realizada"
  | "dias_meses_realizado";

type Resultado = { ok: true } | { ok: false; message: string };

const CAMPOS_VALIDOS: readonly CampoRealizado[] = [
  "valor_unitario_realizado",
  "quantidade_realizada",
  "dias_meses_realizado",
] as const;

/** Aceita "1.234,56" e "1234.56" (mesmo parser da grade de itens da versao). */
function parseNumero(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const normalizado = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/**
 * Cria ou atualiza uma linha de realizado (job, item).
 * Gates:
 * - Job existe no tenant.
 * - Job em status "aberto" ou "em_producao".
 * - User e admin OU responsavel do job.
 * - Item pertence a versao aprovada do job (defense-in-depth).
 * - Valor >= 0.
 * Audit: job.realizado_atualizado (metadata com item_id, campo, valor_novo/anterior).
 */
export async function upsertItemRealizado(
  jobId: string,
  itemId: string,
  campo: CampoRealizado,
  valor: string | null,
): Promise<Resultado> {
  const session = await requireSession();
  const supabase = createClient();

  if (!CAMPOS_VALIDOS.includes(campo)) {
    return { ok: false, message: "Campo invalido." };
  }

  // 1. Carrega job (com tenant lock)
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, tenant_id, status, responsavel_id, versao_orcamento_aprovada_id")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (jobErr || !job) {
    return { ok: false, message: "Job nao encontrado." };
  }

  // 2. Gate de status
  if (job.status !== "aberto" && job.status !== "em_producao") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        acao_tentada: "upsertItemRealizado",
        motivo: "status_bloqueia_edicao",
        status_atual: job.status,
      },
    });
    return {
      ok: false,
      message:
        "Realizado so pode ser lancado com o job em 'Aberto' ou 'Em producao'.",
    };
  }

  // 3. Gate de ownership
  const podeEditar =
    session.activeRole === "administrador" ||
    job.responsavel_id === session.profile.id;

  if (!podeEditar) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        acao_tentada: "upsertItemRealizado",
        motivo: "usuario_nao_e_responsavel_nem_admin",
      },
    });
    return {
      ok: false,
      message: "Apenas o responsavel do job ou um administrador pode editar o realizado.",
    };
  }

  // 4. Valida que o item pertence a versao aprovada do job
  const { data: item, error: itemErr } = await supabase
    .from("versoes_orcamento_itens")
    .select("id, tenant_id, versao_orcamento_id")
    .eq("id", itemId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (itemErr || !item) {
    return { ok: false, message: "Item nao encontrado." };
  }

  if (item.versao_orcamento_id !== job.versao_orcamento_aprovada_id) {
    return {
      ok: false,
      message: "Item nao pertence a versao aprovada deste job.",
    };
  }

  // 5. Parse e valida valor
  const numero = valor === null || valor === "" ? 0 : parseNumero(valor);
  if (numero === null) {
    return { ok: false, message: "Valor invalido." };
  }
  if (numero < 0) {
    return { ok: false, message: "Valor nao pode ser negativo." };
  }

  // 6. Busca linha existente (pra saber valor anterior + decidir insert/update)
  const { data: existente } = await supabase
    .from("jobs_itens_realizado")
    .select("*")
    .eq("job_id", jobId)
    .eq("item_id", itemId)
    .maybeSingle<JobItemRealizado>();

  const valorAnterior = existente ? Number(existente[campo] ?? 0) : 0;

  // 7. Upsert
  const payload: Record<string, unknown> = {
    tenant_id: session.activeTenant.id,
    job_id: jobId,
    item_id: itemId,
    [campo]: numero,
  };
  if (!existente) {
    payload.created_by = session.profile.id;
  }

  const { error: upsertErr } = await supabase
    .from("jobs_itens_realizado")
    .upsert(payload, { onConflict: "job_id,item_id" });

  if (upsertErr) {
    return { ok: false, message: `Falha ao salvar: ${upsertErr.message}` };
  }

  // 8. Audit
  await logAuditEvent({
    acao: "job.realizado_atualizado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      item_id: itemId,
      campo,
      valor_anterior: valorAnterior,
      valor_novo: numero,
    },
  });

  // 9. Revalida
  revalidatePath(`/jobs/${jobId}`);

  return { ok: true };
}
