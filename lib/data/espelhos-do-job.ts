/** Os números do FINANCEIRO de um job — os espelhos `jobs.valor_total`,
 *  `jobs.faturamento_previsto` e `jobs.faturamento_save_previsto`.
 *
 *  Uma conta só, para todo escritor dos espelhos (errata comum, errata de
 *  save, aprovação, recusa, cancelamento, retirada, reenvio): lê a versão
 *  aprovada do job (percentuais e cadeia internacional), as linhas do orçado
 *  do job e os pedidos de save que aguardam, passa as linhas por
 *  `itensParaOFinanceiro` (decisão 099: o financeiro só vê o pedido na
 *  aprovação) e fecha pela mesma `calcularTotaisVersao` do card de Totais.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calcularTotaisVersao,
  type ParametrosInternacionais,
  type VersaoTotais,
} from "@/lib/calculos/versao-totais";
import {
  itensParaOFinanceiro,
  type PedidoParaFinanceiro,
} from "@/lib/calculos/save-financeiro";
import { pedidosParaFinanceiroDoJob } from "@/lib/data/saves";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import type { CategoriaModeloPlanilha, TipoCusto } from "@/lib/types";

/** Uma linha do orçado do job, com o id de `jobs_itens_orcado`. */
export interface LinhaDoEspelho {
  id: string;
  item: string;
  grupo_id: string | null;
  tipo_custo: TipoCusto;
  total_orcado: number;
  valor_unitario_orcado: number;
  em_save: boolean;
  save_consumido: number;
}

export interface BaseDosEspelhos {
  itens: LinhaDoEspelho[];
  /** Pedidos de save que aguardam decisão. */
  pedidos: PedidoParaFinanceiro[];
  percentualHonorarios: number;
  percentualImposto: number;
  internacional: ParametrosInternacionais | null;
  modeloPlanilha: CategoriaModeloPlanilha;
}

/** Os três espelhos, em reais com duas casas, prontos para o `p_totais` das
 *  RPCs de save ou para um `update` de `jobs`. */
export interface EspelhosDoJob {
  valor_total: number;
  faturamento_previsto: number;
  faturamento_save_previsto: number;
}

const dinheiro = (n: number) => Number(n.toFixed(2));

export async function lerBaseDosEspelhos(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<{ ok: true; base: BaseDosEspelhos } | { ok: false; message: string }> {
  // As três leituras são independentes: vão juntas (docs/PERFORMANCE.md).
  const [jobRes, itensRes, pedidosRes] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        // ⚠️ Dicas de FK obrigatórias: há duas FKs entre jobs e
        // versoes_orcamento, e duas entre versoes_orcamento e orcamentos.
        "id, versao:versoes_orcamento!jobs_versao_orcamento_aprovada_id_fkey(percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs, moeda_estrangeira, cambio_compra), orcamento:orcamentos(categoria:categorias_dominio!categoria_id(modelo_planilha))",
      )
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{
        id: string;
        versao: {
          percentual_honorarios: number;
          percentual_imposto: number;
          percentual_int_taxes: number;
          int_transaction_costs: number;
          moeda_estrangeira: string | null;
          cambio_compra: number | null;
        } | null;
        orcamento: { categoria: { modelo_planilha: CategoriaModeloPlanilha } | null } | null;
      }>(),
    supabase
      .from("jobs_itens_orcado")
      .select(
        "id, item, grupo_id, tipo_custo, total_orcado, valor_unitario_orcado, em_save, save_consumido",
      )
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    pedidosParaFinanceiroDoJob(supabase, tenantId, jobId).then(
      (p) => ({ ok: true as const, p }),
      (e: Error) => ({ ok: false as const, e }),
    ),
  ]);
  const job = jobRes.data;
  if (jobRes.error || !job) {
    console.error("[espelhos.job]", jobRes.error?.message);
    return { ok: false, message: "Job não encontrado." };
  }
  if (itensRes.error || !itensRes.data) {
    console.error("[espelhos.itens]", itensRes.error?.message);
    return { ok: false, message: "Não foi possível ler o orçado do job." };
  }
  if (!pedidosRes.ok) {
    console.error(pedidosRes.e.message);
    return { ok: false, message: "Não foi possível ler os pedidos de save do job." };
  }
  const pedidos: PedidoParaFinanceiro[] = pedidosRes.p;

  const planilha = configDaPlanilha(
    job.orcamento?.categoria?.modelo_planilha,
    job.versao ?? {
      percentual_int_taxes: 0,
      int_transaction_costs: 0,
      moeda_estrangeira: null,
      cambio_compra: null,
    },
  );

  return {
    ok: true,
    base: {
      itens: (itensRes.data as any[]).map((i) => ({
        id: i.id,
        item: i.item,
        grupo_id: i.grupo_id ?? null,
        tipo_custo: i.tipo_custo as TipoCusto,
        total_orcado: Number(i.total_orcado ?? 0),
        valor_unitario_orcado: Number(i.valor_unitario_orcado ?? 0),
        em_save: i.em_save === true,
        save_consumido: Number(i.save_consumido ?? 0),
      })),
      pedidos,
      percentualHonorarios: Number(job.versao?.percentual_honorarios ?? 0),
      percentualImposto: Number(job.versao?.percentual_imposto ?? 0),
      internacional: planilha.internacional,
      modeloPlanilha: planilha.modeloPlanilha,
    },
  };
}

/**
 * Fecha os números do financeiro para um conjunto de linhas.
 *
 * `itens` são as linhas no estado que interessa (as de agora, ou as de
 * depois de uma mudança); os pedidos que aguardam são desfeitos na conta,
 * menos os de `contar` — a aprovação conta o pedido que está aprovando.
 */
export function totaisDoFinanceiro(
  itens: LinhaDoEspelho[],
  base: BaseDosEspelhos,
  contar: string[] = [],
): VersaoTotais {
  const vistos = itensParaOFinanceiro(itens, base.pedidos, contar);
  return calcularTotaisVersao(
    vistos.map((i) => ({
      tipo_custo: i.tipo_custo,
      total_orcado: i.total_orcado,
      em_save: i.em_save,
      save_consumido: i.save_consumido,
    })),
    base.percentualHonorarios,
    base.percentualImposto,
    base.internacional,
  );
}

/** Os três espelhos a partir do fechamento. */
export function espelhosDe(totais: VersaoTotais): EspelhosDoJob {
  return {
    valor_total: dinheiro(totais.valorJob),
    faturamento_previsto: dinheiro(totais.faturamentoPrevisto),
    faturamento_save_previsto: dinheiro(totais.save.receita),
  };
}
