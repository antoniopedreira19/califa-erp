import { createClient } from "@/lib/supabase/server";
import { nomeDoJobNoFinanceiro } from "@/lib/types";
import type { SituacaoFaturamento } from "@/lib/calculos/esteira-faturamento";
import {
  faturamentoPorJob,
  FATURAMENTO_VAZIO,
} from "@/lib/data/faturamento-por-job";

export type { SituacaoFaturamento };

/**
 * Um job aberto na visão do financeiro.
 *
 * O nome exibido é o `nome_financeiro` quando existe — é o ponto da tela:
 * o financeiro vê o nome dele, não o da produção (docs/decisions/004 e
 * HANDOFF_FINANCEIRO seção 3).
 *
 * A coluna de faturamento entrou em 13/08/2026, quando o envio para
 * faturamento e a tabela `faturamentos` passaram a existir. Antes disso
 * ficou de fora de propósito: chip ligado em campo inexistente devolve
 * zero linhas sempre, e quem usa conclui que o dado sumiu.
 */
export interface JobAberto {
  id: string;
  codigo: string;
  /** Nome que o financeiro vê (financeiro, com fallback no da produção). */
  nome: string;
  /** Nome da produção, mostrado quando difere — some a dúvida de "que job é esse". */
  nome_producao: string;
  valor_total: number | null;
  data_abertura_financeiro: string | null;
  competencia_trimestre: number | null;
  competencia_ano: number | null;
  categoria_nome: string | null;
  empresa_nome: string | null;
  projeto_id: string;
  projeto_codigo: string | null;
  projeto_nome: string | null;
  /**
   * Projeto do job na visão do financeiro. É por ele que a aba
   * "Visualizar Jobs" agrupa — a arrumação do financeiro é independente
   * da da produção (migration 20260820000011). Nulo só em job aberto
   * antes dessa migration que ninguém tocou desde então; nesse caso a
   * tela cai no projeto da produção.
   */
  projeto_financeiro_id: string | null;
  projeto_financeiro_codigo: string | null;
  projeto_financeiro_nome: string | null;
  cliente_nome: string | null;
  responsavel_nome: string | null;
  regional_nome: string | null;
  produto: string | null;
  situacao_faturamento: SituacaoFaturamento;
  /**
   * O número da linha na coluna Faturamento: valor da nota quando ela
   * existe, valor enviado quando só houve envio, faturamento previsto
   * enquanto nenhum dos dois aconteceu.
   */
  valor_faturamento: number | null;
  numero_nf: string | null;
  data_envio_faturamento: string | null;
  /** Quanto já foi recebido — soma dos títulos pagos da nota. */
  valor_recebido: number;
  /** Vencimento em aberto mais antigo. É o que datar a inadimplência. */
  vencimento_em_aberto: string | null;
}

const SELECT_JOB_ABERTO =
  "id, codigo, nome, nome_financeiro, valor_total, faturamento_previsto, " +
  "data_abertura_financeiro, " +
  "competencia_trimestre, competencia_ano, projeto_id, produto, " +
  "projeto_financeiro_id, " +
  "projeto_financeiro:projetos_financeiro(codigo, nome), " +
  "categoria:categorias_dominio(nome), " +
  "empresa:empresas(razao_social, nome_fantasia), " +
  "regional:regionais(nome), " +
  "responsavel:profiles!responsavel_id(nome), " +
  "projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia))";

/**
 * Todos os jobs já abertos no financeiro, ordenados por código.
 *
 * Duas leituras em paralelo: os jobs e a esteira de faturamento do
 * tenant (`lib/data/faturamento-por-job`, que por dentro faz três
 * leituras rasas e cruza em memória).
 *
 * `hoje` entra por parâmetro para a inadimplência ser testável sem
 * depender do relógio da máquina.
 */
export async function listarJobsAbertos(
  tenantId: string,
  hoje: string = new Date().toISOString().slice(0, 10),
): Promise<JobAberto[]> {
  const supabase = createClient();

  // Duas leituras independentes: os jobs e a esteira de faturamento do
  // tenant inteiro. A esteira mora em `lib/data/faturamento-por-job` —
  // a visão agregada do projeto usa a MESMA classificação, e duas cópias
  // dela divergiriam na primeira nota cancelada.
  const [jobsRes, esteira] = await Promise.all([
    supabase
      .from("jobs")
      .select(SELECT_JOB_ABERTO)
      .eq("tenant_id", tenantId)
      .eq("status", "aberto")
      .order("codigo", { ascending: true }),
    faturamentoPorJob(tenantId, hoje),
  ]);

  const { data, error } = jobsRes;

  if (error) {
    console.error("[jobs-abertos.listar]", error.message);
    return [];
  }

  return ((data ?? []) as any[]).map((j) => {
    const fat = esteira.get(j.id) ?? FATURAMENTO_VAZIO;

    return {
      id: j.id,
      codigo: j.codigo,
      nome: nomeDoJobNoFinanceiro(j),
      nome_producao: j.nome,
      valor_total: j.valor_total !== null ? Number(j.valor_total) : null,
      data_abertura_financeiro: j.data_abertura_financeiro,
      competencia_trimestre: j.competencia_trimestre,
      competencia_ano: j.competencia_ano,
      categoria_nome: j.categoria?.nome ?? null,
      empresa_nome: j.empresa?.nome_fantasia ?? j.empresa?.razao_social ?? null,
      projeto_id: j.projeto_id,
      projeto_codigo: j.projeto?.codigo ?? null,
      projeto_nome: j.projeto?.nome ?? null,
      projeto_financeiro_id: j.projeto_financeiro_id ?? null,
      projeto_financeiro_codigo: j.projeto_financeiro?.codigo ?? null,
      projeto_financeiro_nome: j.projeto_financeiro?.nome ?? null,
      cliente_nome: j.projeto?.cliente?.nome_fantasia ?? null,
      responsavel_nome: j.responsavel?.nome ?? null,
      regional_nome: j.regional?.nome ?? null,
      produto: j.produto,
      situacao_faturamento: fat.situacao,
      // Sem nota nem envio, a coluna mostra o que a abertura previu.
      valor_faturamento:
        fat.valor ??
        (j.faturamento_previsto !== null && j.faturamento_previsto !== undefined
          ? Number(j.faturamento_previsto)
          : null),
      numero_nf: fat.numero_nf,
      data_envio_faturamento: fat.data_envio,
      valor_recebido: fat.valor_recebido,
      vencimento_em_aberto: fat.vencimento_em_aberto,
    };
  });
}
