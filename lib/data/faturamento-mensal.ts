/**
 * O faturamento de cada mês de um job do modelo mensal, lido do banco —
 * Fee e Always On (decisão 078, entrega 3).
 *
 * Lê a cópia do job (`jobs_itens_orcado`, com as erratas), os grupos e os
 * meses da versão aprovada, e fecha cada mês por `faturamentoPorMes`. É o
 * número que o servidor usa no envio do mês e na previsão de recebimento —
 * nunca o que o navegador mandou.
 *
 * É leitura do FINANCEIRO (o envio do mês e a revisão da abertura): as
 * linhas passam por `itensParaOFinanceiro` (decisão 099), e um save que
 * ainda aguarda aprovação não entra na parte de save do mês. `contar` são
 * os pedidos que valem como aprovados — o que a revisão está aprovando.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  faturamentoPorMes,
  type FaturamentoDoMes,
} from "@/lib/calculos/faturamento-por-mes";
import { mesesDaVersaoQuery } from "./meses-versao";
import { pedidosParaFinanceiroDoJob } from "./saves";
import { itensParaOFinanceiro } from "@/lib/calculos/save-financeiro";

export async function lerFaturamentoPorMesDoJob(
  supabase: SupabaseClient,
  {
    tenantId,
    jobId,
    versaoAprovadaId,
    percentualHonorarios,
    percentualImposto,
    contar,
  }: {
    tenantId: string;
    jobId: string;
    versaoAprovadaId: string;
    percentualHonorarios: number;
    percentualImposto: number;
    /** Pedidos de save que contam como aprovados (a revisão que aprova). */
    contar: string[];
  },
): Promise<FaturamentoDoMes[] | null> {
  const [mesesRes, gruposRes, itensRes, pedidos] = await Promise.all([
    mesesDaVersaoQuery(supabase, tenantId, versaoAprovadaId),
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, mes_id")
      .eq("versao_orcamento_id", versaoAprovadaId)
      .eq("tenant_id", tenantId)
      .returns<{ id: string; mes_id: string | null }[]>(),
    supabase
      .from("jobs_itens_orcado")
      .select("id, grupo_id, tipo_custo, total_orcado, em_save, save_consumido")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    pedidosParaFinanceiroDoJob(supabase, tenantId, jobId).catch((e: Error) => {
      console.error(e.message);
      return null;
    }),
  ]);
  const erro = mesesRes.error ?? gruposRes.error ?? itensRes.error;
  if (erro) {
    console.error("[faturamento-mensal.ler]", erro.message);
    return null;
  }
  // Sem os pedidos a parte de save do mês sairia errada em silêncio.
  if (pedidos === null) return null;
  const itens = itensParaOFinanceiro(
    ((itensRes.data ?? []) as any[]).map((i) => ({
      ...i,
      em_save: i.em_save === true,
      save_consumido: Number(i.save_consumido ?? 0),
    })),
    pedidos,
    contar,
  );
  return faturamentoPorMes(
    mesesRes.data ?? [],
    gruposRes.data ?? [],
    itens as Parameters<typeof faturamentoPorMes>[2],
    percentualHonorarios,
    percentualImposto,
  );
}

/**
 * O mesmo, partindo só do id do job: descobre o modelo pela categoria do
 * orçamento e só lê os meses quando ele é mensal. `meses` nulo num job
 * mensal é leitura que falhou; o retorno nulo é o job que não se leu.
 * Serve à abertura do financeiro (previsão de recebimento por mês).
 */
export async function lerFaturamentoMensalPeloJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  /** Pedidos de save que contam como aprovados (a revisão que aprova). */
  contar: string[],
): Promise<{ mensal: boolean; meses: FaturamentoDoMes[] | null } | null> {
  const { data: job, error } = await supabase
    .from("jobs")
    .select(
      "id, versao_orcamento_aprovada_id, " +
        "versao:versoes_orcamento!versao_orcamento_aprovada_id(percentual_honorarios, percentual_imposto), " +
        // `!categoria_id`: `orcamentos` tem duas FKs para `categorias_dominio`.
        "orcamento:orcamentos(categoria:categorias_dominio!categoria_id(modelo_planilha))",
    )
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      versao_orcamento_aprovada_id: string | null;
      versao: {
        percentual_honorarios: number | string | null;
        percentual_imposto: number | string | null;
      } | null;
      orcamento: { categoria: { modelo_planilha: string } | null } | null;
    }>();
  if (error || !job) {
    if (error) console.error("[faturamento-mensal.job]", error.message);
    return null;
  }
  if (job.orcamento?.categoria?.modelo_planilha !== "mensal") {
    return { mensal: false, meses: null };
  }
  if (!job.versao_orcamento_aprovada_id || !job.versao) {
    return { mensal: true, meses: null };
  }
  const meses = await lerFaturamentoPorMesDoJob(supabase, {
    tenantId,
    jobId,
    versaoAprovadaId: job.versao_orcamento_aprovada_id,
    percentualHonorarios: Number(job.versao.percentual_honorarios ?? 0),
    percentualImposto: Number(job.versao.percentual_imposto ?? 0),
    contar,
  });
  return { mensal: true, meses };
}
