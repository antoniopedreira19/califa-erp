/**
 * Meses da versão do orçamento mensal — Fee e Always On (decisão 078).
 *
 * As portas de entrada de versão (criar orçamento, nova versão, duplicar)
 * precisam criar ou copiar os meses do mesmo jeito. Um helper só, para as
 * três não divergirem na regra de "os meses nascem do período".
 *
 * Falha aqui não desfaz a versão: a tela da versão mensal sem mês mostra
 * o "Editar meses" para criar os que faltam — o mesmo degrau seguro da v1
 * que nasce sem grupo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { VersaoOrcamentoMes } from "@/lib/types";
import {
  erroDoPeriodoMensal,
  mesesDoPeriodo,
} from "@/lib/calculos/meses-trimestre";

type Supabase = SupabaseClient<any, any, any>;

/** Devolve a PROMISE: quem chama põe no `Promise.all` que já tem. */
export function mesesDaVersaoQuery(
  supabase: Supabase,
  tenantId: string,
  versaoId: string,
) {
  return supabase
    .from("versoes_orcamento_meses")
    .select("*")
    .eq("versao_orcamento_id", versaoId)
    .eq("tenant_id", tenantId)
    .order("mes", { ascending: true })
    .returns<VersaoOrcamentoMes[]>();
}

/** Cria os meses que o período do orçamento cobre. Período inválido não
 *  cria nada e devolve a frase para quem quiser mostrar. */
export async function criarMesesDoPeriodo(
  supabase: Supabase,
  {
    tenantId,
    versaoId,
    profileId,
    inicio,
    fim,
  }: {
    tenantId: string;
    versaoId: string;
    profileId: string;
    inicio: string | null;
    fim: string | null;
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const erro = erroDoPeriodoMensal(inicio, fim);
  if (erro) return { ok: false, message: erro };

  const linhas = mesesDoPeriodo({ inicio: inicio!, fim: fim! }).map((mes) => ({
    tenant_id: tenantId,
    versao_orcamento_id: versaoId,
    mes,
    created_by: profileId,
  }));
  const { error } = await supabase.from("versoes_orcamento_meses").insert(linhas);
  if (error) {
    console.error("[meses-versao.criar]", error.message);
    return { ok: false, message: "Não foi possível criar os meses do orçamento." };
  }
  return { ok: true };
}

/** Copia os meses de uma versão para outra e devolve o mapa
 *  `mes_id antigo → mes_id novo`, que os grupos copiados usam. */
export async function copiarMesesEntreVersoes(
  supabase: Supabase,
  {
    tenantId,
    origemId,
    destinoId,
    profileId,
  }: {
    tenantId: string;
    origemId: string;
    destinoId: string;
    profileId: string;
  },
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const { data: origem, error } = await mesesDaVersaoQuery(
    supabase,
    tenantId,
    origemId,
  );
  if (error) {
    console.error("[meses-versao.copiar.ler]", error.message);
    return mapa;
  }
  if (!origem || origem.length === 0) return mapa;

  const { data: novos, error: insErr } = await supabase
    .from("versoes_orcamento_meses")
    .insert(
      origem.map((m) => ({
        tenant_id: tenantId,
        versao_orcamento_id: destinoId,
        mes: m.mes,
        created_by: profileId,
      })),
    )
    .select("id, mes")
    .returns<Pick<VersaoOrcamentoMes, "id" | "mes">[]>();
  if (insErr || !novos) {
    console.error("[meses-versao.copiar.gravar]", insErr?.message);
    return mapa;
  }
  // Casamento pelo mês: é único dentro da versão.
  for (const m of origem) {
    const novo = novos.find((n) => n.mes === m.mes);
    if (novo) mapa.set(m.id, novo.id);
  }
  return mapa;
}
