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
    return "Data da mudança precisa ser posterior à data em que a alocação vigente começou.";
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

  // Se usa rateio, duas condições precisam bater:
  //   1) empresa tem 2+ regionais (ratear em 1 é degenerado — a UI oculta
  //      o toggle, mas se alguém burlar (curl, DevTools), servidor bloqueia)
  //   2) empresa tem rateio configurado no ano da data de mudança —
  //      sem isso, gerarFolha vai pular na hora; melhor pegar aqui.
  if (input.usa_rateio_empresa) {
    const { count: qtdRegionais } = await supabase
      .from("regionais")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("empresa_id", input.empresa_id)
      .eq("ativo", true);
    if (!qtdRegionais || qtdRegionais < 2) {
      return {
        ok: false,
        message:
          'Esta empresa tem só uma regional; escolha a regional específica em vez de "Todas as regionais".',
      };
    }

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
        message: `Esta empresa não tem rateio configurado para ${anoMudanca}. Configure em Administração → Rateios regionais antes de alocar.`,
      };
    }
  }

  // 1) Fecha vigente atual (se houver). Duas trilhas:
  //
  //    a) data_mudanca > data_inicio da vigente → fechamento normal em
  //       data_mudanca - 1 dia (mudança real de estado do colaborador).
  //
  //    b) data_mudanca <= data_inicio da vigente → tratamos como
  //       CORREÇÃO: a vigente atual nunca foi realmente "válida" e vai
  //       ser substituída. DELETE em vez de UPDATE (fechar em dia
  //       anterior violaria chk_alocacoes_periodo_valido: data_fim <
  //       data_inicio).
  //
  // Isso permite ao operador fixar erros de alocação recém-criados sem
  // esperar 1 dia pra editar.
  const { data: vigente } = await supabase
    .from("colaboradores_alocacoes")
    .select("id, data_inicio")
    .eq("colaborador_id", colaboradorId)
    .eq("tenant_id", session.activeTenant.id)
    .is("data_fim", null)
    .maybeSingle();

  if (vigente) {
    if (input.data_mudanca <= vigente.data_inicio) {
      const { error: delError } = await supabase
        .from("colaboradores_alocacoes")
        .delete()
        .eq("id", vigente.id);
      if (delError) {
        console.error("[rh.alocacao.deletar_corrigindo]", delError.message);
        return { ok: false, message: mapAlocacaoDbError(delError.message) };
      }
    } else {
      const dataFim = diaAnterior(input.data_mudanca);
      const { error: upError } = await supabase
        .from("colaboradores_alocacoes")
        .update({ data_fim: dataFim })
        .eq("id", vigente.id);
      if (upError) {
        console.error("[rh.alocacao.fechar]", upError.message);
        return { ok: false, message: mapAlocacaoDbError(upError.message) };
      }
    }
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
