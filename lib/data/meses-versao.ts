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
  nomeDoMes,
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

/** Os meses sem nenhum item, pelo nome ("dezembro"), em ordem. O item mora
 *  no grupo e o grupo no mês — mês só com grupo vazio também conta como
 *  vazio. É a regra que bloqueia a aprovação (Tiago, 14/09/2026). */
export function mesesSemItens(
  meses: Pick<VersaoOrcamentoMes, "id" | "mes">[],
  grupos: { id: string; mes_id: string | null }[],
  itens: { grupo_id: string }[],
): string[] {
  const gruposComItem = new Set(itens.map((i) => i.grupo_id));
  const mesesComItem = new Set(
    grupos
      .filter((g) => g.mes_id !== null && gruposComItem.has(g.id))
      .map((g) => g.mes_id),
  );
  return [...meses]
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .filter((m) => !mesesComItem.has(m.id))
    .map((m) => nomeDoMes(m.mes));
}

/** `mesesSemItens` lido do banco, para o servidor não confiar na tela.
 *  `null` quando a leitura falha — quem chama recusa, em vez de aprovar
 *  sem ter conferido. */
export async function mesesSemItensDaVersao(
  supabase: Supabase,
  tenantId: string,
  versaoId: string,
): Promise<string[] | null> {
  const [mesesRes, gruposRes, itensRes] = await Promise.all([
    mesesDaVersaoQuery(supabase, tenantId, versaoId),
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, mes_id")
      .eq("versao_orcamento_id", versaoId)
      .eq("tenant_id", tenantId)
      .returns<{ id: string; mes_id: string | null }[]>(),
    supabase
      .from("versoes_orcamento_itens")
      .select("grupo_id")
      .eq("versao_orcamento_id", versaoId)
      .eq("tenant_id", tenantId)
      .returns<{ grupo_id: string }[]>(),
  ]);
  const erro = mesesRes.error ?? gruposRes.error ?? itensRes.error;
  if (erro) {
    console.error("[meses-versao.sem-itens]", erro.message);
    return null;
  }
  return mesesSemItens(mesesRes.data ?? [], gruposRes.data ?? [], itensRes.data ?? []);
}
