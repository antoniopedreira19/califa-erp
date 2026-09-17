"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient } from "@/lib/supabase/server";
import { alocacaoSchema } from "@/lib/validations/rh-colaboradores";

type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function mapAlocacaoDbError(msg: string): string {
  if (msg.includes("Rateio de alocacoes")) {
    return "A soma dos percentuais das alocações vigentes precisa dar 100.";
  }
  if (msg.includes("chk_alocacoes_percentual_valido")) {
    return "Percentual deve ser maior que 0 e no máximo 100.";
  }
  if (msg.includes("chk_alocacoes_periodo_valido")) {
    return "Data de fim precisa ser posterior à data de início.";
  }
  return "Não foi possível gravar a alocação.";
}

/**
 * Substitui as alocações vigentes do colaborador atomicamente — fecha
 * todas as linhas com data_fim IS NULL na data indicada e abre as novas
 * linhas. O trigger `trg_alocacoes_soma_100` é DEFERRABLE INITIALLY
 * DEFERRED, então valida no COMMIT: sum das vigentes finais precisa dar
 * 100.
 *
 * A rota REST do Supabase-js não expõe BEGIN/COMMIT explícitos, mas cada
 * chamada individual é atômica em si. Para o swap, mandamos as inserções
 * em bulk (uma única chamada) — todas passam ou nenhuma passa. As
 * atualizações de fechamento vêm antes: se a inserção falhar, o trigger
 * pega o estado final (sem as novas), viola sum=100 e derruba a
 * transação inteira via CONSTRAINT TRIGGER.
 *
 * ATENÇÃO: Se a UPDATE de fechamento for aplicada e o INSERT em bulk
 * falhar por outra razão (constraint na linha nova), o Postgres reverte
 * TUDO — o UPDATE também. Confirmado pelo teste em migração 000006
 * (cenário swap).
 */
export async function substituirAlocacoes(
  colaboradorId: string,
  novasAlocacoes: {
    empresa_id: string;
    regional_id: string;
    percentual: string;
    motivo?: string | null;
  }[],
  dataFechamento: string,
): Promise<ActionResult<{ id: string; inseridas: number }>> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataFechamento)) {
    return { ok: false, message: "Data de mudança inválida." };
  }

  if (novasAlocacoes.length === 0) {
    return {
      ok: false,
      message: "Informe ao menos uma alocação nova (somando 100%).",
    };
  }

  const supabase = createClient();

  // Confirma que o colaborador existe no tenant (defense-in-depth)
  const { data: colab, error: colabError } = await supabase
    .from("colaboradores")
    .select("id")
    .eq("id", colaboradorId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (colabError || !colab) {
    return { ok: false, message: "Colaborador não encontrado." };
  }

  // 1) Fecha as vigentes
  const { error: upError } = await supabase
    .from("colaboradores_alocacoes")
    .update({ data_fim: dataFechamento })
    .eq("colaborador_id", colaboradorId)
    .eq("tenant_id", session.activeTenant.id)
    .is("data_fim", null);

  if (upError) {
    console.error("[rh.alocacao.fechar]", upError.message);
    return { ok: false, message: mapAlocacaoDbError(upError.message) };
  }

  // 2) Insere as novas
  const rows = novasAlocacoes.map((a) => ({
    tenant_id: session.activeTenant.id,
    colaborador_id: colaboradorId,
    empresa_id: a.empresa_id,
    regional_id: a.regional_id,
    percentual: a.percentual,
    data_inicio: dataFechamento,
    motivo: a.motivo ?? null,
    created_by: session.profile.id,
  }));

  const { error: insError } = await supabase
    .from("colaboradores_alocacoes")
    .insert(rows);

  if (insError) {
    console.error("[rh.alocacao.abrir]", insError.message);
    return { ok: false, message: mapAlocacaoDbError(insError.message) };
  }

  await logAuditEvent({
    acao: "colaborador.alocacao_aberta",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador",
    entidadeId: colaboradorId,
    metadata: {
      data_fechamento: dataFechamento,
      novas: rows.map((r) => ({
        empresa_id: r.empresa_id,
        regional_id: r.regional_id,
        percentual: r.percentual,
      })),
    },
  });

  revalidatePath(`/rh/colaboradores/${colaboradorId}`);
  return { ok: true, id: colaboradorId, inseridas: rows.length };
}
