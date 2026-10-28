"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient } from "@/lib/supabase/server";
import {
  validarInputPacote,
  type InputPacote,
} from "@/lib/alocacao/validar-input-pacote";

type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function mapAlocacaoDbError(msg: string): string {
  if (msg.includes("chk_alocacao_regional_xor_rateio")) {
    return 'Alocação inconsistente: escolha regional específica OU ligue "Todas as regionais", não os dois.';
  }
  if (msg.includes("fk_alocacao_regional_pertence_empresa")) {
    return "A regional selecionada não pertence à empresa escolhida.";
  }
  if (msg.includes("uniq_colaborador_alocacao_vigente")) {
    return "Este colaborador já tem uma alocação vigente.";
  }
  if (msg.includes("chk_alocacoes_periodo_valido")) {
    return "Data da mudança precisa ser posterior à data em que a alocação vigente começou.";
  }
  if (msg.includes("enforce_alocacao_itens_soma_100")) {
    return "A soma dos percentuais de empresa deve ser exatamente 100%.";
  }
  if (msg.includes("enforce_alocacao_item_regionais_soma_100")) {
    return "A soma dos percentuais regionais de um item deve ser exatamente 100%.";
  }
  if (msg.includes("enforce_alocacao_item_regionais_nao_vazia")) {
    return "Quando o rateio da empresa não está ativado, o item deve ter pelo menos uma regional.";
  }
  if (msg.includes("enforce_alocacao_item_regional_vazia_quando_rateio")) {
    return 'Não é permitido informar regionais quando "Usar rateio da empresa" está ativado.';
  }
  if (msg.includes("não pertence à empresa")) {
    return "A regional selecionada não pertence à empresa escolhida.";
  }
  if (msg.includes("não encontrada no tenant")) {
    return "Empresa não encontrada.";
  }
  return "Não foi possível gravar a alocação.";
}

/**
 * Novo modelo multi-empresa (2026-10-28): um colaborador pode ser alocado
 * em N empresas simultaneamente. Cada item define a % da empresa e,
 * opcionalmente, a divisão regional dentro dela.
 *
 * A RPC `trocar_pacote_alocacao` executa tudo atomicamente:
 *   1. Fecha (ou deleta) a alocação vigente.
 *   2. Cria o pacote novo.
 *   3. Insere N itens + M regionais.
 *   4. Triggers DEFERRED validam soma 100 no COMMIT.
 *
 * `validarInputPacote` roda no servidor antes da RPC para dar feedback
 * rápido de UI sem ir ao banco.
 */
export async function alterarAlocacao(
  colaboradorId: string,
  input: {
    data_mudanca: string;
    motivo?: string | null;
    itens: Array<{
      empresa_id: string;
      percentual_empresa: number;
      usa_rateio_empresa: boolean;
      regionais: Array<{ regional_id: string; percentual_regional: number }>;
    }>;
  },
): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.data_mudanca)) {
    return { ok: false, message: "Data de mudança inválida." };
  }

  // Validação client-friendly antes de chamar o banco
  const pacoteInput: InputPacote = { itens: input.itens };
  const validacao = validarInputPacote(pacoteInput);
  if (!validacao.ok) {
    return { ok: false, message: validacao.erros.join("; ") };
  }

  const supabase = createClient();

  const { data: resultado, error: rpcError } = await supabase.rpc(
    "trocar_pacote_alocacao",
    {
      p_tenant_id: session.activeTenant.id,
      p_colaborador_id: colaboradorId,
      p_data_mudanca: input.data_mudanca,
      p_motivo: input.motivo ?? null,
      p_itens: input.itens,
    },
  );

  if (rpcError) {
    console.error("[rh.alocacao.trocar_pacote]", rpcError.message);
    return { ok: false, message: mapAlocacaoDbError(rpcError.message) };
  }

  const pacoteId = resultado as string;

  await logAuditEvent({
    acao: "colaborador.alocacao_aberta",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador",
    entidadeId: colaboradorId,
    metadata: {
      pacote_id: pacoteId,
      data_mudanca: input.data_mudanca,
      motivo: input.motivo ?? null,
      num_itens: input.itens.length,
    },
  });

  revalidatePath(`/rh/colaboradores/${colaboradorId}`);
  return { ok: true, id: pacoteId };
}

/**
 * Wrapper legado para compatibilidade com a UI atual (card-alocacoes.tsx).
 * Converte o shape antigo (1 empresa, 1 regional opcional) para o pacote
 * multi-empresa com 1 item a 100%.
 *
 * TODO (Tasks 5/6): substituir o call site em card-alocacoes.tsx pela nova
 * UI multi-empresa e remover este wrapper.
 */
export async function alterarAlocacaoLegacy(
  colaboradorId: string,
  input: {
    empresa_id: string;
    usa_rateio_empresa: boolean;
    regional_id: string | null;
    data_mudanca: string;
    motivo?: string | null;
  },
): Promise<ActionResult<{ id: string }>> {
  const regionais =
    !input.usa_rateio_empresa && input.regional_id
      ? [{ regional_id: input.regional_id, percentual_regional: 100 }]
      : [];

  return alterarAlocacao(colaboradorId, {
    data_mudanca: input.data_mudanca,
    motivo: input.motivo,
    itens: [
      {
        empresa_id: input.empresa_id,
        percentual_empresa: 100,
        usa_rateio_empresa: input.usa_rateio_empresa,
        regionais,
      },
    ],
  });
}
