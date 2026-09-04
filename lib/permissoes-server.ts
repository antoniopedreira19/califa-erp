/**
 * Matriz de permissoes do ERP California — parte SERVER-ONLY.
 *
 * As duas funcoes aqui gravam `acao_negada` na auditoria (via
 * `logAuditEvent`, que puxa `createClient` do supabase server, que puxa
 * `next/headers`). Por isso este arquivo **nao pode** ser importado
 * por client component: quebra o build do Next.
 *
 * Client components (ex.: sidebar) importam `pode`, `getRolesFor`, etc.
 * do arquivo puro em `lib/permissoes.ts`. Server actions e server
 * components de pagina importam `checarPermissao`/`requirePermissao`
 * daqui.
 *
 * Historico: ate 04/09/2026 tudo vivia num arquivo so; o build da Vercel
 * quebrou porque o sidebar puxava a chain sidebar -> permissoes ->
 * audit -> next/headers. Solucao: split.
 */

import type { SessionContext } from "./types";
import { logAuditEvent } from "./auth/audit";
import {
  PermissaoNegadaError,
  pode,
  respostaPermissaoNegada,
  type Recurso,
} from "./permissoes";

/**
 * Server actions devem chamar isso no inicio, apos requireSession().
 * Lanca `PermissaoNegadaError` se o papel nao autoriza e grava tentativa
 * em audit_events como `acao_negada`.
 *
 * O metadata opcional entra no evento — util pra registrar `{ orcamentoId,
 * versaoId }` etc. e permitir reconstituir o que o usuario tentou.
 */
export async function requirePermissao(
  session: SessionContext,
  recurso: Recurso,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (pode(session.activeRole, recurso)) return;

  // Registra tentativa negada. Falhas de auditoria nao bloqueiam a
  // negativa — logAuditEvent ja engole erros internamente.
  await logAuditEvent({
    acao: "acao_negada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "permissao",
    entidadeId: recurso,
    metadata: {
      recurso,
      papel: session.activeRole,
      ...(metadata ?? {}),
    },
  });

  throw new PermissaoNegadaError(recurso);
}

/**
 * Variante nao-throw de `requirePermissao` que devolve um Result no
 * mesmo formato que as server actions ja usam. Padrao pra gate no topo
 * de acao:
 *
 *   const session = await requireSession();
 *   const gate = await checarPermissao(session, "orcamentos.aprovar");
 *   if (!gate.ok) return gate;
 *
 * Registra tentativa negada em audit_events do mesmo jeito que
 * requirePermissao.
 */
export async function checarPermissao(
  session: SessionContext,
  recurso: Recurso,
  metadata?: Record<string, unknown>,
): Promise<
  | { ok: true }
  | { ok: false; message: string; code: "permissao_negada"; recurso: Recurso }
> {
  if (pode(session.activeRole, recurso)) return { ok: true };

  await logAuditEvent({
    acao: "acao_negada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "permissao",
    entidadeId: recurso,
    metadata: {
      recurso,
      papel: session.activeRole,
      ...(metadata ?? {}),
    },
  });

  return respostaPermissaoNegada(recurso);
}
