"use server";

/**
 * Aprovação da prestação de contas da verba pelo financeiro (decisão 081).
 *
 * Até 15/09/2026 este arquivo tinha `fecharPrestacaoVerba`: o próprio
 * financeiro digitava o gasto e fechava a prestação, que já nascia com a
 * devolução. A prestação passou para a produção (aba de PPs do job), e o
 * financeiro ficou com a conferência: aprovar — o que cria o estorno do
 * saldo na data prevista — ou reprovar com motivo.
 *
 * Papel e estado são checados de novo dentro das funções do banco; o gate
 * aqui existe para registrar a tentativa negada na auditoria, como as
 * outras ações do financeiro.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

const BUCKET = "pedidos-compra";
const ANEXO_TTL_SEGUNDOS = 3600;

type Ok<T extends object = object> = { ok: true } & T;
type Err = { ok: false; message: string };
type Result<T extends object = object> = Ok<T> | Err;

async function gateFinanceiro(
  ppId: string,
  acaoTentada: string,
): Promise<
  | {
      ok: true;
      session: Awaited<ReturnType<typeof requireSession>>;
      supabase: ReturnType<typeof createClient>;
    }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: ppId,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return {
      ok: false,
      message: "Apenas admin ou financeiro pode executar esta ação.",
    };
  }
  return { ok: true, session, supabase };
}

const aprovarSchema = z.object({
  pp_id: z.string().uuid(),
  data_prevista: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data prevista inválida.")
    .nullable(),
});

export async function aprovarPrestacaoVerba(
  input: z.input<typeof aprovarSchema>,
): Promise<Result<{ codigo: string; estornoCriado: boolean }>> {
  const parsed = aprovarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const gate = await gateFinanceiro(parsed.data.pp_id, "verba_producao.prestacao_aprovada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: estornoId, error } = await supabase.rpc("aprovar_prestacao_verba", {
    p_pp_id: parsed.data.pp_id,
    p_data_prevista: parsed.data.data_prevista,
  });
  if (error) return { ok: false, message: error.message };

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("codigo, job_id")
    .eq("id", parsed.data.pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  await logAuditEvent({
    acao: "verba_producao.prestacao_aprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parsed.data.pp_id,
    metadata: {
      pp_codigo: pp?.codigo ?? null,
      estorno_id: estornoId ?? null,
      data_prevista: parsed.data.data_prevista,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  if (pp?.job_id) revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true, codigo: pp?.codigo ?? "", estornoCriado: estornoId != null };
}

const reprovarSchema = z.object({
  pp_id: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(10, "O motivo precisa ter pelo menos 10 caracteres.")
    .max(500, "Motivo passa de 500 caracteres."),
});

export async function reprovarPrestacaoVerba(
  input: z.input<typeof reprovarSchema>,
): Promise<Result<{ codigo: string }>> {
  const parsed = reprovarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const gate = await gateFinanceiro(parsed.data.pp_id, "verba_producao.prestacao_reprovada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { error } = await supabase.rpc("reprovar_prestacao_verba", {
    p_pp_id: parsed.data.pp_id,
    p_motivo: parsed.data.motivo,
  });
  if (error) return { ok: false, message: error.message };

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("codigo, job_id")
    .eq("id", parsed.data.pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  await logAuditEvent({
    acao: "verba_producao.prestacao_reprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parsed.data.pp_id,
    metadata: { pp_codigo: pp?.codigo ?? null, motivo: parsed.data.motivo },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  if (pp?.job_id) revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true, codigo: pp?.codigo ?? "" };
}

/**
 * Gera uma URL assinada (TTL 1h) para um documento da prestação.
 * Valida tenant antes de assinar — impede acesso cross-tenant.
 */
export async function signedUrlAnexoPrestacao(
  anexo_id: string,
): Promise<Result<{ url: string }>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: anexo, error } = await supabase
    .from("pp_verba_prestacoes_anexos")
    .select("arquivo_path")
    .eq("id", anexo_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (error || !anexo) {
    return { ok: false, message: "Anexo não encontrado." };
  }

  const { data: signed, error: signedErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(anexo.arquivo_path, ANEXO_TTL_SEGUNDOS);

  if (signedErr || !signed) {
    return { ok: false, message: "Não foi possível gerar o link." };
  }

  return { ok: true, url: signed.signedUrl };
}
