import type { SupabaseClient } from "@supabase/supabase-js";
import {
  montarBaseDosEspelhos,
  SELECT_ITENS_DOS_ESPELHOS,
  SELECT_JOB_DOS_ESPELHOS,
  totaisDoFinanceiro,
  type JobDosEspelhos,
} from "@/lib/data/espelhos-do-job";
import { pedidosParaFinanceiroDoTenant } from "@/lib/data/saves";
import {
  linhasComPlanejadoDevolvido,
  planejadoAntesDoSave,
} from "@/lib/calculos/save-financeiro";
import { planejadoBrutoDoItem } from "@/lib/calculos/bv-planilha";
import { fechamentoDosItens } from "@/lib/calculos/midia-off";
import { rentabilidadeDoJob } from "@/lib/calculos/abertura-do-job";
import type { PlanejadoAntesDoSave } from "@/lib/types";

/**
 * A Rentabilidade de cada job do financeiro, para as listas "Visualizar
 * Jobs" e "Resultado de Job" (decisão 207).
 *
 * É o MESMO número da página do job — o "Resultado Op. (Planejado)" do
 * cabeçalho e a "Rentabilidade" do registro da abertura: valor do job −
 * impostos − custo planejado, na conta do financeiro (Tiago, 23/10/2026:
 * "não podemos ter rentabilidade se referindo a coisas diferentes em um
 * mesmo sistema"). Por isso nada aqui refaz a conta: as linhas passam pelas
 * mesmas funções da página —
 *
 *   * valor do job e deduções: `totaisDoFinanceiro` sobre a base de
 *     `montarBaseDosEspelhos` (`resumoComoOFinanceiroVe` na página);
 *   * custo planejado: `planejadoBrutoDoItem` linha a linha, ou o
 *     `fechamentoDosItens` da Mídia Off (`carregarDetalheDoJob`), mais o
 *     planejado que um pedido de gerar save ainda aguardando zerou;
 *   * o par R$ e %: `rentabilidadeDoJob`, a conta do registro da abertura.
 *
 * Só as leituras são outras: o tenant inteiro de uma vez, numa rodada de
 * consultas em paralelo, em vez de uma rodada por job
 * (`docs/PERFORMANCE.md`). As linhas do orçado vêm em páginas de 1.000, o
 * teto do PostgREST — em 23/10/2026 eram 2.335 linhas no tenant, 1.718 dos
 * 95 jobs da lista.
 *
 * Job que falta na resposta (sem versão aprovada, ou leitura que falhou)
 * fica sem rentabilidade: a lista mostra travessão, e não um zero.
 */
export interface RentabilidadeDoJob {
  valorJob: number;
  deducoes: number;
  custoPlanejado: number;
  /** Em R$, arredondada ao centavo. */
  valor: number;
  /** Em % do valor do job; 0 quando o valor do job é zero. */
  percentual: number;
}

const PAGINA = 1000;

/** As colunas das linhas: as dos espelhos, mais as do custo planejado. */
const SELECT_ITENS =
  `job_id, ${SELECT_ITENS_DOS_ESPELHOS}, total_planejado, planejado_antes_save`;

type LinhaDoOrcado = {
  id: string;
  job_id: string;
  item: string;
  grupo_id: string | null;
  tipo_custo: string;
  total_orcado: number | string | null;
  valor_unitario_orcado: number | string | null;
  em_save: boolean | null;
  save_consumido: number | string | null;
  total_planejado: number | string | null;
  planejado_antes_save: PlanejadoAntesDoSave | null;
};

/** Uma página das linhas do orçado do tenant, na ordem estável do id. */
async function paginaDoOrcado(
  supabase: SupabaseClient,
  tenantId: string,
  n: number,
): Promise<LinhaDoOrcado[]> {
  const { data, error } = await supabase
    .from("jobs_itens_orcado")
    .select(SELECT_ITENS)
    .eq("tenant_id", tenantId)
    // Ordem estável: sem ela, duas páginas podem repetir ou pular linhas.
    .order("id", { ascending: true })
    .range(n * PAGINA, n * PAGINA + PAGINA - 1);
  if (error) throw new Error(`[rentabilidade-dos-jobs.itens] ${error.message}`);
  return (data ?? []) as unknown as LinhaDoOrcado[];
}

/**
 * Quantas páginas pedir de saída, todas juntas e junto das outras leituras.
 * Página além do fim volta vazia e custa pouco; contar as linhas antes
 * (`count: "exact"`) custava mais que as páginas (medido em 23/10/2026).
 */
const PAGINAS_DE_SAIDA = 4;

/**
 * Todas as linhas do orçado dos jobs do tenant: as primeiras páginas em
 * paralelo e, se a última delas vier cheia, as seguintes até a página que
 * não enche.
 */
async function linhasDoOrcadoDoTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<LinhaDoOrcado[]> {
  const lidas = await Promise.all(
    Array.from({ length: PAGINAS_DE_SAIDA }, (_, n) => paginaDoOrcado(supabase, tenantId, n)),
  );
  for (let n = PAGINAS_DE_SAIDA; lidas[lidas.length - 1].length === PAGINA; n++) {
    lidas.push(await paginaDoOrcado(supabase, tenantId, n));
  }
  return lidas.flat();
}

export async function rentabilidadeDosJobs(
  supabase: SupabaseClient,
  tenantId: string,
  /** Os status da lista que pede (`STATUS_NA_LISTA`). */
  status: readonly string[],
): Promise<Map<string, RentabilidadeDoJob>> {
  const saida = new Map<string, RentabilidadeDoJob>();
  try {
    const [jobsRes, linhas, pedidosPorJob] = await Promise.all([
      supabase
        .from("jobs")
        .select(SELECT_JOB_DOS_ESPELHOS)
        .eq("tenant_id", tenantId)
        .in("status", status as string[])
        .returns<JobDosEspelhos[]>(),
      linhasDoOrcadoDoTenant(supabase, tenantId),
      pedidosParaFinanceiroDoTenant(supabase, tenantId),
    ]);
    if (jobsRes.error) throw new Error(`[rentabilidade-dos-jobs.jobs] ${jobsRes.error.message}`);

    const linhasPorJob = new Map<string, LinhaDoOrcado[]>();
    for (const l of linhas) {
      const lista = linhasPorJob.get(l.job_id) ?? [];
      lista.push(l);
      linhasPorJob.set(l.job_id, lista);
    }

    for (const job of jobsRes.data ?? []) {
      if (!job.versao) continue;
      const linhasDoJob = linhasPorJob.get(job.id) ?? [];
      const pedidos = pedidosPorJob.get(job.id) ?? [];
      const base = montarBaseDosEspelhos(job, linhasDoJob, pedidos);
      const totais = totaisDoFinanceiro(base.itens, base);

      // O custo planejado da planilha do job, como `carregarDetalheDoJob`:
      // na Mídia Off, as notas dos veículos; nos outros modelos, o
      // planejado de cada linha (a linha em save sai da conta).
      const custoDaPlanilha = base.midia
        ? fechamentoDosItens(linhasDoJob, base.midia).custoPlanejado
        : linhasDoJob.reduce(
            (s, l) => s + planejadoBrutoDoItem(Number(l.total_planejado ?? 0), l.em_save === true),
            0,
          );
      // O planejado que um pedido de gerar save que aguarda já zerou volta
      // para a conta, como em `resumoComoOFinanceiroVe`.
      const devolvidas = new Set(linhasComPlanejadoDevolvido(pedidos));
      const planejadoDosPedidos = linhasDoJob
        .filter((l) => devolvidas.has(l.id))
        .reduce((s, l) => s + planejadoAntesDoSave(l.planejado_antes_save), 0);

      const entrada = {
        valorJob: totais.valorJob,
        deducoes: totais.deducoesDoResultado,
        custoPlanejado: custoDaPlanilha + planejadoDosPedidos,
      };
      saida.set(job.id, { ...entrada, ...rentabilidadeDoJob(entrada) });
    }
  } catch (e) {
    // Sem a rentabilidade a lista continua de pé, com travessão na coluna.
    console.error("[rentabilidade-dos-jobs]", e instanceof Error ? e.message : e);
    return new Map();
  }
  return saida;
}
