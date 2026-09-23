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
import { mesesDaVersaoQuery } from "@/lib/data/meses-versao";
import {
  faturamentoPorMes,
  type GrupoComMes,
  type MesDoJob,
} from "@/lib/calculos/faturamento-por-mes";
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

/** Modelo mensal (decisão 078): os meses da versão aprovada, o mês de cada
 *  agrupamento e os meses que já foram enviados para faturamento. */
export interface MesesDoEspelho {
  meses: MesDoJob[];
  grupos: GrupoComMes[];
  /** `YYYY-MM-01` de cada mês com envio para faturamento. */
  enviados: string[];
}

export interface BaseDosEspelhos {
  itens: LinhaDoEspelho[];
  /** Pedidos de save que aguardam decisão. */
  pedidos: PedidoParaFinanceiro[];
  percentualHonorarios: number;
  percentualImposto: number;
  internacional: ParametrosInternacionais | null;
  modeloPlanilha: CategoriaModeloPlanilha;
  /** Só no modelo mensal; nulo nos outros. */
  mensal: MesesDoEspelho | null;
}

/** Os três espelhos, em reais com duas casas, prontos para o `p_totais` das
 *  RPCs de save ou para um `update` de `jobs`. */
export interface EspelhosDoJob {
  valor_total: number;
  faturamento_previsto: number;
  faturamento_save_previsto: number;
}

/** A parte de save de um mês já enviado para faturamento (modelo mensal). */
export interface SaveDoMesEnviado {
  mes: string;
  valor_save: number;
}

/** O `p_totais` das RPCs de save: os três espelhos e, no modelo mensal com
 *  mês já enviado, a parte de save de cada um desses meses — que o envio
 *  gravou em `jobs_envio_faturamento.valor_save` e que a fila e o fluxo de
 *  caixa leem. A chave só existe quando há mês enviado: o banco recusa
 *  `saves_por_mes` que não seja lista. */
export type TotaisParaRpc = EspelhosDoJob & { saves_por_mes?: SaveDoMesEnviado[] };

const dinheiro = (n: number) => Number(n.toFixed(2));

export async function lerBaseDosEspelhos(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  /** `comMeses: false` pula a leitura dos meses do mensal — para quem só
   *  quer os espelhos (`totaisDoFinanceiro`) e não manda `saves_por_mes`. */
  opcoes: { comMeses?: boolean } = {},
): Promise<{ ok: true; base: BaseDosEspelhos } | { ok: false; message: string }> {
  // As três leituras são independentes: vão juntas (docs/PERFORMANCE.md).
  const [jobRes, itensRes, pedidosRes] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        // ⚠️ Dicas de FK obrigatórias: há duas FKs entre jobs e
        // versoes_orcamento, e duas entre versoes_orcamento e orcamentos.
        "id, versao_orcamento_aprovada_id, versao:versoes_orcamento!jobs_versao_orcamento_aprovada_id_fkey(percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs, moeda_estrangeira, cambio_compra), orcamento:orcamentos(categoria:categorias_dominio!categoria_id(modelo_planilha))",
      )
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{
        id: string;
        versao_orcamento_aprovada_id: string | null;
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

  // Modelo mensal: os meses, o mês de cada agrupamento e os meses já
  // enviados — só para a parte de save dos meses enviados (`totaisParaRpc`).
  let mensal: MesesDoEspelho | null = null;
  if (
    opcoes.comMeses !== false &&
    planilha.modeloPlanilha === "mensal" &&
    job.versao_orcamento_aprovada_id
  ) {
    const versaoId = job.versao_orcamento_aprovada_id;
    const [mesesRes, gruposRes, enviosRes] = await Promise.all([
      mesesDaVersaoQuery(supabase, tenantId, versaoId),
      supabase
        .from("versoes_orcamento_grupos")
        .select("id, mes_id")
        .eq("versao_orcamento_id", versaoId)
        .eq("tenant_id", tenantId)
        .returns<GrupoComMes[]>(),
      supabase
        .from("jobs_envio_faturamento")
        .select("mes")
        .eq("job_id", jobId)
        .eq("tenant_id", tenantId)
        .not("mes", "is", null)
        .returns<{ mes: string }[]>(),
    ]);
    const erro = mesesRes.error ?? gruposRes.error ?? enviosRes.error;
    if (erro) {
      // Sem os meses a parte de save do mês enviado sairia errada em silêncio.
      console.error("[espelhos.meses]", erro.message);
      return { ok: false, message: "Não foi possível ler os meses do job." };
    }
    mensal = {
      meses: (mesesRes.data ?? []).map((m) => ({ id: m.id, mes: m.mes })),
      grupos: gruposRes.data ?? [],
      enviados: (enviosRes.data ?? []).map((e) => e.mes),
    };
  }

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
      mensal,
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

/**
 * A parte de save de cada mês JÁ enviado para faturamento, com as linhas no
 * estado que interessa — a mesma conta do envio do mês
 * (`lerFaturamentoPorMesDoJob` → `faturamentoPorMes`), para o número do
 * envio seguir o save aprovado ou retirado depois dele (decisão 099). Nulo
 * fora do mensal ou sem mês enviado.
 */
export function savesDosMesesEnviados(
  itens: LinhaDoEspelho[],
  base: BaseDosEspelhos,
  contar: string[] = [],
): SaveDoMesEnviado[] | null {
  const mensal = base.mensal;
  if (!mensal || mensal.enviados.length === 0) return null;
  const vistos = itensParaOFinanceiro(itens, base.pedidos, contar);
  const porMes = faturamentoPorMes(
    mensal.meses,
    mensal.grupos,
    vistos.map((i) => ({
      grupo_id: i.grupo_id ?? "",
      tipo_custo: i.tipo_custo,
      total_orcado: i.total_orcado,
      em_save: i.em_save,
      save_consumido: i.save_consumido,
    })),
    base.percentualHonorarios,
    base.percentualImposto,
  );
  return porMes
    .filter((m) => mensal.enviados.includes(m.mes))
    .map((m) => ({ mes: m.mes, valor_save: m.save }));
}

/** O `p_totais` das RPCs de save que mexem nos números do financeiro. */
export function totaisParaRpc(
  itens: LinhaDoEspelho[],
  base: BaseDosEspelhos,
  contar: string[] = [],
): TotaisParaRpc {
  const espelhos = espelhosDe(totaisDoFinanceiro(itens, base, contar));
  const porMes = savesDosMesesEnviados(itens, base, contar);
  return porMes ? { ...espelhos, saves_por_mes: porMes } : espelhos;
}
