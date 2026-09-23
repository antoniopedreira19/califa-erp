/**
 * O imposto previsto do job — a base do cronograma de recolhimento da
 * abertura (decisão 100).
 *
 * Módulo comum, sem `"use server"`: quem lê é a página da abertura (para
 * mostrar) e a Server Action (para conferir a soma). A action NÃO confia
 * no número que veio do navegador — relê daqui, como já faz com o custo e
 * o faturamento previstos.
 *
 * O número sai do MESMO `calcularTotaisVersao` do card de Totais da
 * planilha interna, sobre a cópia do orçado do job e a versão aprovada:
 *
 *   * lado `faturamento` do fechamento — o imposto da nota que a California
 *     emite. Sem save, é o mesmo imposto do card de Totais;
 *   * no internacional, imposto brasileiro + int. taxes. Os custos de
 *     transação ficam de fora (Tiago, 23/09/2026 — decisão adiada).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularTotaisVersao } from "@/lib/calculos/versao-totais";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import { emCentavos } from "./curva";

export interface ImpostoDoJob {
  /** O total que o cronograma de recolhimento precisa fechar. */
  impostoPrevisto: number;
  /** Alíquota do imposto brasileiro da versão aprovada, em %. */
  aliquotaImposto: number;
  /** Int. taxes da versão, em % — nulo fora do internacional. */
  aliquotaIntTaxes: number | null;
  /** Valor do job e deduções do resultado, pela mesma cadeia — o que a
   *  tela usa para comparar a rentabilidade com a da planilha. */
  valorJob: number;
  deducoesDoResultado: number;
}

export async function impostoDoJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<ImpostoDoJob | null> {
  const [jobRes, itensRes] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "versao:versoes_orcamento!versao_orcamento_aprovada_id(percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs, moeda_estrangeira, cambio_compra), " +
          "orcamento:orcamentos(categoria:categorias_dominio!categoria_id(modelo_planilha))",
      )
      .eq("tenant_id", tenantId)
      .eq("id", jobId)
      .maybeSingle(),
    supabase
      .from("jobs_itens_orcado")
      .select("tipo_custo, total_orcado, em_save, save_consumido")
      .eq("tenant_id", tenantId)
      .eq("job_id", jobId),
  ]);

  if (jobRes.error || itensRes.error) {
    console.error(
      "[abertura-job.imposto]",
      (jobRes.error ?? itensRes.error)?.message,
    );
    return null;
  }

  const job = jobRes.data as any;
  const versao = job?.versao ?? null;
  if (!versao) return null;

  // Qual fechamento: pela categoria do ORÇAMENTO, nunca a do job
  // (decisão 072) — a mesma função da planilha interna.
  const planilha = configDaPlanilha(
    job?.orcamento?.categoria?.modelo_planilha,
    versao,
  );
  const totais = calcularTotaisVersao(
    ((itensRes.data ?? []) as any[]).map((i) => ({
      tipo_custo: i.tipo_custo,
      total_orcado: i.total_orcado,
      em_save: i.em_save,
      save_consumido: i.save_consumido,
    })),
    Number(versao.percentual_honorarios ?? 0),
    Number(versao.percentual_imposto ?? 0),
    planilha.internacional,
  );

  return {
    impostoPrevisto: emCentavos(
      totais.faturamento.imposto + totais.faturamento.intTaxes,
    ),
    aliquotaImposto: Number(versao.percentual_imposto ?? 0),
    aliquotaIntTaxes: planilha.internacional
      ? planilha.internacional.percentualIntTaxes
      : null,
    valorJob: totais.valorJob,
    deducoesDoResultado: totais.deducoesDoResultado,
  };
}
