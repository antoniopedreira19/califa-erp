/**
 * O job é de Mídia Off? Com quais condições? (decisão 167)
 *
 * Quem decide a conta é a categoria do ORÇAMENTO de origem (decisão 072),
 * e as condições da mídia — honorários, imposto, base e a parte do veículo
 * — são as da versão aprovada. Quem lê: a abertura do financeiro (custo
 * previsto), o envio do faturamento de cada mês e o encerramento junto com
 * o último envio.
 *
 * Sem `"use server"`: é leitura, chamada de dentro das actions e das
 * páginas.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  desembolsoDaMidia,
  fechamentoDosItens,
  parametrosDaVersao,
  ultimaVeiculacaoDoMes,
  type FechamentoMidia,
  type ParametrosMidia,
} from "@/lib/calculos/midia-off";

export type MidiaDoJob =
  | { ok: true; midia: ParametrosMidia | null }
  | { ok: false };

export async function lerMidiaDoJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<MidiaDoJob> {
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, " +
        "versao:versoes_orcamento!versao_orcamento_aprovada_id(percentual_honorarios, percentual_imposto, percentual_veiculo, base_honorarios), " +
        // `!categoria_id`: `orcamentos` tem duas FKs para `categorias_dominio`.
        "orcamento:orcamentos(categoria:categorias_dominio!categoria_id(modelo_planilha))",
    )
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      versao: {
        percentual_honorarios: number | string | null;
        percentual_imposto: number | string | null;
        percentual_veiculo: number | string | null;
        base_honorarios: string | null;
      } | null;
      orcamento: { categoria: { modelo_planilha: string } | null } | null;
    }>();
  if (error || !data) {
    if (error) console.error("[midia-do-job]", error.message);
    return { ok: false };
  }
  if (data.orcamento?.categoria?.modelo_planilha !== "midia_off") {
    return { ok: true, midia: null };
  }
  if (!data.versao) return { ok: false };
  return {
    ok: true,
    midia: parametrosDaVersao({
      percentual_honorarios: data.versao.percentual_honorarios ?? 0,
      percentual_imposto: data.versao.percentual_imposto ?? 0,
      base_honorarios: data.versao.base_honorarios,
      percentual_veiculo: data.versao.percentual_veiculo,
    }),
  };
}

const AINDA_NAO_DISPONIVEL = {
  errata: "A errata do job de Mídia Off ainda não está disponível: chega com a errata da veiculação.",
  alteracao:
    "O orçado do job de Mídia Off ainda não se edita por aqui: chega com a errata da veiculação.",
  pp: "A PP do job de Mídia Off ainda não está disponível: chega com a PP do repasse ao veículo.",
} as const;

/**
 * O que o job de Mídia Off ainda não tem (decisão 167, entrega 2): errata,
 * edição do orçado pelo financeiro e PP. A tela do job não oferece nenhum
 * dos três — a planilha da mídia é só leitura —, e esta trava segura a
 * action chamada por fora dela. Devolve a mensagem da recusa, ou `null`
 * para seguir. Leitura que falha recusa: a action não sabe a conta do job.
 */
export async function travaDoJobDeMidia(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  acao: keyof typeof AINDA_NAO_DISPONIVEL,
): Promise<string | null> {
  const lida = await lerMidiaDoJob(supabase, tenantId, jobId);
  if (!lida.ok) return "Não foi possível conferir o job. Tente de novo.";
  return lida.midia ? AINDA_NAO_DISPONIVEL[acao] : null;
}

/**
 * A última veiculação de um mês do job (`mes` = `YYYY-MM-01`), pelas linhas
 * da CÓPIA: o envio do faturamento do mês só libera no dia seguinte a ela
 * (Tiago, 07 e 13/10/2026). O mês da linha é o do agrupamento da versão
 * (`jobs_itens_orcado.grupo_id`, a âncora — decisão 162). `undefined`
 * quando a leitura falhou; `null` sem data nas linhas.
 */
export async function lerUltimaVeiculacaoDoMes(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  versaoAprovadaId: string,
  mes: string,
): Promise<string | null | undefined> {
  const [mesesRes, gruposRes, linhasRes] = await Promise.all([
    supabase
      .from("versoes_orcamento_meses")
      .select("id, mes")
      .eq("versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", tenantId)
      .eq("mes", mes)
      .returns<{ id: string; mes: string }[]>(),
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, mes_id")
      .eq("versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", tenantId)
      .returns<{ id: string; mes_id: string | null }[]>(),
    supabase
      .from("jobs_itens_orcado")
      .select("grupo_id, insercoes_por_dia, data_fim")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .returns<
        { grupo_id: string; insercoes_por_dia: Record<string, number> | null; data_fim: string | null }[]
      >(),
  ]);
  const erro = mesesRes.error ?? gruposRes.error ?? linhasRes.error;
  if (erro) {
    console.error("[midia-do-job.ultima-veiculacao]", erro.message);
    return undefined;
  }
  const mesId = (mesesRes.data ?? [])[0]?.id;
  if (!mesId) return null;
  const gruposDoMes = new Set(
    (gruposRes.data ?? []).filter((g) => g.mes_id === mesId).map((g) => g.id),
  );
  return ultimaVeiculacaoDoMes(
    mes,
    (linhasRes.data ?? []).filter((l) => gruposDoMes.has(l.grupo_id)),
  );
}

/** O fechamento da mídia do job inteiro, pela cópia das linhas: o que as
 *  telas do financeiro mostram no lugar dos totais nacionais — o custo
 *  previsto (`desembolso`, a nota dos veículos em A · Repasse) e o custo
 *  planejado (as notas de todos os veículos). `null` fora da Mídia Off;
 *  `undefined` quando a leitura falhou. */
export async function lerFechamentoMidiaDoJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<
  { midia: ParametrosMidia; f: FechamentoMidia; desembolso: number } | null | undefined
> {
  const [lida, itensRes] = await Promise.all([
    lerMidiaDoJob(supabase, tenantId, jobId),
    supabase
      .from("jobs_itens_orcado")
      .select("tipo_custo, total_orcado")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .returns<{ tipo_custo: string; total_orcado: number | string | null }[]>(),
  ]);
  if (!lida.ok || itensRes.error) {
    if (itensRes.error) console.error("[midia-do-job.fechamento]", itensRes.error.message);
    return undefined;
  }
  if (!lida.midia) return null;
  const itens = itensRes.data ?? [];
  return {
    midia: lida.midia,
    f: fechamentoDosItens(itens, lida.midia),
    desembolso: desembolsoDaMidia(itens, lida.midia),
  };
}
