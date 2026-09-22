"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient } from "@/lib/supabase/server";

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
    return "Data de fim precisa ser posterior à data de início.";
  }
  return "Não foi possível gravar a alocação.";
}

/**
 * Sub-1 dia de uma data ISO (YYYY-MM-DD). Usado pra fechar a alocação
 * vigente no dia anterior ao início da nova.
 */
function diaAnterior(iso: string): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Novo modelo (2026-09-23): 1 alocação vigente por colaborador. Sem
 * rateio em %. Ou é regional específica (usa_rateio_empresa=false +
 * regional_id) ou é "toda a empresa" (usa_rateio_empresa=true +
 * regional_id=null), e no momento da geração da folha o rateio da
 * empresa+ano expande em N linhas do snapshot.
 *
 * `alterarAlocacao` fecha a vigente atual em `data_mudanca - 1 dia` e
 * abre a nova em `data_mudanca`. Índice UNIQUE parcial em
 * `(colaborador_id) where data_fim is null` garante que só há 1
 * vigente por vez.
 */
export async function alterarAlocacao(
  colaboradorId: string,
  input: {
    empresa_id: string;
    usa_rateio_empresa: boolean;
    regional_id: string | null;
    data_mudanca: string;
    motivo?: string | null;
  },
): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.data_mudanca)) {
    return { ok: false, message: "Data de mudança inválida." };
  }
  if (input.usa_rateio_empresa && input.regional_id) {
    return {
      ok: false,
      message: 'Regional não pode ser preenchida quando "Todas as regionais" está ligado.',
    };
  }
  if (!input.usa_rateio_empresa && !input.regional_id) {
    return { ok: false, message: "Selecione uma regional." };
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

  // Se usa rateio, empresa tem que ter rateio configurado no ano da
  // data de mudança. Sem isso, gerarFolha vai bloquear na hora — melhor
  // pegar aqui.
  if (input.usa_rateio_empresa) {
    const anoMudanca = Number(input.data_mudanca.slice(0, 4));
    const { count: temRateio } = await supabase
      .from("empresas_rateios_regionais")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("empresa_id", input.empresa_id)
      .eq("ano_vigencia", anoMudanca);
    if (!temRateio || temRateio === 0) {
      return {
        ok: false,
        message: `Esta empresa não tem rateio configurado para ${anoMudanca}. Configure em Cadastros → Empresas → Rateio antes de alocar.`,
      };
    }
  }

  const dataFim = diaAnterior(input.data_mudanca);

  // 1) Fecha vigente atual (se houver)
  const { error: upError } = await supabase
    .from("colaboradores_alocacoes")
    .update({ data_fim: dataFim })
    .eq("colaborador_id", colaboradorId)
    .eq("tenant_id", session.activeTenant.id)
    .is("data_fim", null);

  if (upError) {
    console.error("[rh.alocacao.fechar]", upError.message);
    return { ok: false, message: mapAlocacaoDbError(upError.message) };
  }

  // 2) Abre nova vigente
  const { error: insError } = await supabase
    .from("colaboradores_alocacoes")
    .insert({
      tenant_id: session.activeTenant.id,
      colaborador_id: colaboradorId,
      empresa_id: input.empresa_id,
      regional_id: input.regional_id,
      usa_rateio_empresa: input.usa_rateio_empresa,
      data_inicio: input.data_mudanca,
      motivo: input.motivo ?? null,
      created_by: session.profile.id,
    });

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
      data_mudanca: input.data_mudanca,
      empresa_id: input.empresa_id,
      usa_rateio_empresa: input.usa_rateio_empresa,
      regional_id: input.regional_id,
    },
  });

  revalidatePath(`/rh/colaboradores/${colaboradorId}`);
  return { ok: true, id: colaboradorId };
}
