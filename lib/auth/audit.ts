import { createClient } from "@/lib/supabase/server";

export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.login_negado"
  | "auth.senha_alterada"
  // ações reservadas para tasks futuras (registradas aqui para consistência):
  | "cliente.criado"
  | "cliente.editado"
  | "cliente.inativado"
  | "fornecedor.criado"
  | "fornecedor.editado"
  | "fornecedor.inativado"
  | "orcamento.criado"
  | "orcamento.editado"
  | "versao_orcamento.criada"
  | "versao_orcamento.importada"
  | "versao_orcamento.aprovada"
  | "job.criado"
  | "custo_c.utilizado"
  | "acao_negada";

export interface AuditPayload {
  acao: AuditAction;
  tenantId?: string | null;
  entidadeTipo?: string | null;
  entidadeId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Grava um evento em audit_events via RPC log_audit_event.
 * A RPC roda com SECURITY DEFINER — não depende de RLS de INSERT — mas
 * exige usuário autenticado. Falhas de auditoria não devem quebrar o
 * fluxo principal (login etc), então erros são apenas logados.
 */
export async function logAuditEvent(payload: AuditPayload): Promise<void> {
  try {
    const supabase = createClient();
    const { error } = await supabase.rpc("log_audit_event", {
      p_acao: payload.acao,
      p_tenant_id: payload.tenantId ?? null,
      p_entidade_tipo: payload.entidadeTipo ?? null,
      p_entidade_id: payload.entidadeId ?? null,
      p_metadata: (payload.metadata ?? {}) as any,
    });
    if (error && process.env.NODE_ENV !== "production") {
      console.warn("[audit] falha ao gravar evento", payload.acao, error.message);
    }
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[audit] exceção ao gravar evento", err);
    }
  }
}
