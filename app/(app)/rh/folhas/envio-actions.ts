"use server";

/**
 * Server actions de envio de folha por origem.
 *
 * - enviarFolhaPJ  → origem "california" (PJ gerado internamente).
 *   Aplica fechamento de benefícios (se necessário) e gera avulsas de operadora.
 * - enviarFolhaCLT → origem "contabilidade" (CLT importado via PDF).
 *   Sem benefícios: só marca as linhas como enviadas.
 *
 * Spec: docs/superpowers/specs/2026-11-26-ferias-pagina-colaborador-documentos-por-folha-design.md
 */

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient } from "@/lib/supabase/server";
import type { AvulsaGerada } from "@/lib/types";

type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

// ---------------------------------------------------------------------------
// enviarFolhaPJ
// ---------------------------------------------------------------------------

/**
 * Envia todas as linhas PJ (origem "california") de uma competência.
 *
 * Fluxo:
 * 1. Verifica se existe fechamento de benefícios vigente.
 * 2. Se não existir, aplica via RPC (podendo descobrir que não há vínculos ativos).
 * 3. Se há fechamento, gera as avulsas de operadora.
 * 4. Atualiza o status das linhas rascunho/pendente_correcao → enviada.
 * 5. Registra auditoria e revalida paths.
 */
export async function enviarFolhaPJ(args: {
  ano: number;
  mes: number;
}): Promise<
  ActionResult<{
    linhas_enviadas: number;
    fechamento_id: string | null;
    avulsas: AvulsaGerada[];
    sem_beneficios: boolean;
  }>
> {
  const { ano, mes } = args;

  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.editar_rh");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const nowIso = new Date().toISOString();
  const mesPad2 = String(mes).padStart(2, "0");

  // -------------------------------------------------------------------------
  // Passo 3: Buscar fechamento de benefícios vigente
  // -------------------------------------------------------------------------
  const { data: fechamentoVigente } = await supabase
    .from("beneficio_fechamento_mensal")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("ano", ano)
    .eq("mes", mes)
    .is("reaberto_em", null)
    .maybeSingle();

  let fechamentoId: string | null = fechamentoVigente?.id ?? null;
  let semBeneficios = false;
  let avulsas: AvulsaGerada[] = [];

  // -------------------------------------------------------------------------
  // Passo 4: Se não existir fechamento, aplicar via RPC
  // -------------------------------------------------------------------------
  if (!fechamentoId) {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "aplicar_fechamento_beneficios",
      { p_tenant_id: tenantId, p_ano: ano, p_mes: mes },
    );

    if (rpcError) {
      if (rpcError.message.includes("nenhum_vinculo_ativo")) {
        // Tenant sem benefícios ativos nessa competência — OK, segue sem avulsa.
        semBeneficios = true;
        fechamentoId = null;
      } else if (rpcError.message.includes("catalogo_incompleto")) {
        // Extrair o nome do benefício que está incompleto (vem após "catalogo_incompleto: ")
        const nomeBeneficio = rpcError.message
          .split("catalogo_incompleto:")
          .at(1)
          ?.trim();
        return {
          ok: false,
          message: `Catálogo de benefícios está incompleto: ${nomeBeneficio}. Edite em /rh/beneficios → Catálogo antes de enviar.`,
        };
      } else {
        return {
          ok: false,
          message: `Falha ao aplicar benefícios: ${rpcError.message}`,
        };
      }
    } else if (rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
      fechamentoId = (rpcData[0] as { fechamento_id: string }).fechamento_id;
    }
  }

  // -------------------------------------------------------------------------
  // Passo 5: Gerar avulsas de operadora (se há fechamento)
  // -------------------------------------------------------------------------
  if (fechamentoId) {
    const { data: avulsasData, error: errAvulsas } = await supabase.rpc(
      "gerar_avulsas_fechamento_beneficios",
      { p_fechamento_id: fechamentoId },
    );

    if (errAvulsas) {
      return {
        ok: false,
        message: `Falha ao gerar avulsas de benefícios: ${errAvulsas.message}`,
      };
    }

    avulsas = ((avulsasData as AvulsaGerada[] | null) ?? []);
  }

  // -------------------------------------------------------------------------
  // Passo 6: UPDATE folhas_pagamento (rascunho | pendente_correcao → enviada)
  // -------------------------------------------------------------------------
  const { data: afetadas, error: errUpdate } = await supabase
    .from("folhas_pagamento")
    .update({
      status: "enviada",
      enviada_em: nowIso,
      enviada_por: session.profile.id,
      motivo_pendencia: null,
    })
    .eq("tenant_id", tenantId)
    .eq("competencia_ano", ano)
    .eq("competencia_mes", mes)
    .eq("tipo", "salario")
    .eq("origem", "california")
    .in("status", ["rascunho", "pendente_correcao"])
    .select("id");

  if (errUpdate) {
    return {
      ok: false,
      message: `Falha ao enviar linhas PJ: ${errUpdate.message}`,
    };
  }

  if (!afetadas || afetadas.length === 0) {
    return {
      ok: false,
      message:
        "Não há linha PJ para enviar (rascunho ou pendente de correção).",
    };
  }

  const linhasEnviadas = afetadas.length;

  // -------------------------------------------------------------------------
  // Passo 7: Auditoria
  // -------------------------------------------------------------------------
  await logAuditEvent({
    acao: "folha_competencia.enviada",
    tenantId,
    entidadeTipo: "folha_competencia",
    entidadeId: `${ano}-${mesPad2}`,
    metadata: {
      ano,
      mes,
      origem: "california",
      linhas_enviadas: linhasEnviadas,
      fechamento_id: fechamentoId,
      avulsas,
      sem_beneficios: semBeneficios,
    },
  });

  // -------------------------------------------------------------------------
  // Passo 8: Revalidar paths
  // -------------------------------------------------------------------------
  revalidatePath("/rh/folhas");
  revalidatePath(`/rh/folhas/${ano}-${mesPad2}`);
  revalidatePath("/rh/beneficios");
  revalidatePath("/financeiro/contas-a-pagar");

  // -------------------------------------------------------------------------
  // Passo 9: Retorno
  // -------------------------------------------------------------------------
  return {
    ok: true,
    linhas_enviadas: linhasEnviadas,
    fechamento_id: fechamentoId,
    avulsas,
    sem_beneficios: semBeneficios,
  };
}

// ---------------------------------------------------------------------------
// enviarFolhaCLT
// ---------------------------------------------------------------------------

/**
 * Envia todas as linhas CLT (origem "contabilidade") de uma competência.
 *
 * Sem envolvimento de benefícios: apenas muda o status rascunho/pendente_correcao
 * → enviada das linhas importadas da contabilidade.
 */
export async function enviarFolhaCLT(args: {
  ano: number;
  mes: number;
}): Promise<ActionResult<{ linhas_enviadas: number }>> {
  const { ano, mes } = args;

  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.editar_rh");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const nowIso = new Date().toISOString();
  const mesPad2 = String(mes).padStart(2, "0");

  // -------------------------------------------------------------------------
  // Passo 3: UPDATE folhas_pagamento (rascunho | pendente_correcao → enviada)
  // -------------------------------------------------------------------------
  const { data: afetadas, error: errUpdate } = await supabase
    .from("folhas_pagamento")
    .update({
      status: "enviada",
      enviada_em: nowIso,
      enviada_por: session.profile.id,
      motivo_pendencia: null,
    })
    .eq("tenant_id", tenantId)
    .eq("competencia_ano", ano)
    .eq("competencia_mes", mes)
    .eq("tipo", "salario")
    .eq("origem", "contabilidade")
    .in("status", ["rascunho", "pendente_correcao"])
    .select("id");

  if (errUpdate) {
    return {
      ok: false,
      message: `Falha ao enviar linhas CLT: ${errUpdate.message}`,
    };
  }

  if (!afetadas || afetadas.length === 0) {
    return {
      ok: false,
      message:
        "Não há linha CLT para enviar (rascunho ou pendente de correção).",
    };
  }

  const linhasEnviadas = afetadas.length;

  // -------------------------------------------------------------------------
  // Passo 5: Auditoria
  // -------------------------------------------------------------------------
  await logAuditEvent({
    acao: "folha_competencia.enviada",
    tenantId,
    entidadeTipo: "folha_competencia",
    entidadeId: `${ano}-${mesPad2}`,
    metadata: {
      ano,
      mes,
      origem: "contabilidade",
      linhas_enviadas: linhasEnviadas,
    },
  });

  // -------------------------------------------------------------------------
  // Passo 6: Revalidar paths (SEM /rh/beneficios e /financeiro/contas-a-pagar)
  // -------------------------------------------------------------------------
  revalidatePath("/rh/folhas");
  revalidatePath(`/rh/folhas/${ano}-${mesPad2}`);

  // -------------------------------------------------------------------------
  // Passo 7: Retorno
  // -------------------------------------------------------------------------
  return {
    ok: true,
    linhas_enviadas: linhasEnviadas,
  };
}
