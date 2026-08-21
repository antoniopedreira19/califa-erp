import { createClient } from "@/lib/supabase/server";
import { nomeDoJobNoFinanceiro, type JobStatus } from "@/lib/types";
import type { SituacaoFaturamento } from "@/lib/calculos/esteira-faturamento";
import {
  faturamentoPorJob,
  FATURAMENTO_VAZIO,
} from "@/lib/data/faturamento-por-job";

/**
 * Projeto na visão do financeiro (`projetos_financeiro`).
 *
 * Não é o projeto da produção. `jobs.projeto_id` continua nascendo do
 * orçamento e mandando em Orçamentos e na página de Jobs; este aqui é a
 * arrumação que o financeiro faz dos jobs dele, e a produção nunca vê —
 * mesmo contrato de `jobs.nome_financeiro` vs `jobs.nome`.
 *
 * A tabela nasceu espelhando `projetos` (backfill da migration
 * 20260820000011) para o combo não abrir vazio; a partir dali as duas
 * arrumações divergem à vontade.
 */
export interface ProjetoFinanceiroOpcao {
  id: string;
  codigo: string;
  nome: string;
  cliente_id: string;
  cliente_nome: string | null;
}

/**
 * Projetos do financeiro ativos, para o combo da abertura.
 *
 * `clienteId` filtra por cliente: agrupar jobs de clientes diferentes sob
 * o mesmo projeto não é arrumação, é engano — e o combo do protótipo já
 * mostra o cliente em cada linha justamente para isso ficar visível.
 */
export async function listarProjetosFinanceiro(
  tenantId: string,
  clienteId?: string | null,
): Promise<ProjetoFinanceiroOpcao[]> {
  const supabase = createClient();

  let query = supabase
    .from("projetos_financeiro")
    .select("id, codigo, nome, cliente_id, cliente:clientes(nome_fantasia)")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("codigo", { ascending: true });

  if (clienteId) query = query.eq("cliente_id", clienteId);

  const { data, error } = await query;

  if (error) {
    console.error("[projetos-financeiro.listar]", error.message);
    return [];
  }

  return ((data ?? []) as any[]).map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nome: p.nome,
    cliente_id: p.cliente_id,
    cliente_nome: p.cliente?.nome_fantasia ?? null,
  }));
}

/**
 * Status que entram na visão agregada do projeto no financeiro.
 *
 * Decisão do Tiago (20/08/2026): "os que aguardam abertura, abertos,
 * faturados e encerrados". Faturado não é status — é job aberto com nota
 * emitida, e aparece na coluna Faturamento.
 *
 * Ficam DE FORA `rejeitado_financeiro` e `cancelado`: são jobs que o
 * financeiro devolveu ou que morreram, e somá-los no total do projeto
 * seria contar dinheiro que não vai existir.
 *
 * `em_producao` entra junto de `aberto`. É status legado (nenhum job novo
 * cai nele), mas quem estiver lá passou pela abertura — tirá-lo faria o
 * job sumir do agregado no meio da vida.
 */
export const STATUS_NO_AGREGADO = [
  "aguardando_abertura",
  "aberto",
  "em_producao",
  "encerrado",
] as const;

export interface JobDoProjetoFinanceiro {
  id: string;
  codigo: string;
  /** Nome que o financeiro vê (financeiro, com fallback no da produção). */
  nome: string;
  status: JobStatus;
  competencia_trimestre: number | null;
  competencia_ano: number | null;
  valor_total: number;
  /** O que a California prevê receber do cliente. Base da margem. */
  faturamento_previsto: number;
  /** Curva da abertura. Nulo em job que ainda não foi aberto. */
  custo_previsto: number | null;
  situacao_faturamento: SituacaoFaturamento;
  /**
   * Já passou pela abertura no financeiro?
   *
   * Decide se o job SOMA nos totais. Job que ainda aguarda abertura
   * aparece na lista — é trabalho aprovado que vem por aí —, mas não
   * entra em conta nenhuma: ele tem ZERO linhas em `vw_fluxo_caixa`, sem
   * previsão de recebimento e sem curva de desembolso, porque as duas
   * nascem na abertura. Somar o faturável dele aqui faria o total do
   * projeto afirmar um dinheiro que o financeiro ainda não conhece
   * (decisão do Tiago, 21/08/2026).
   */
  aberto_no_financeiro: boolean;
}

export interface ProjetoFinanceiroAgregado {
  id: string;
  codigo: string;
  nome: string;
  cliente_nome: string | null;
  jobs: JobDoProjetoFinanceiro[];
  totalValor: number;
  totalFaturamento: number;
  totalCusto: number;
  /**
   * Faturamento previsto − custo previsto. NÃO é valor total − custo:
   * o valor total inclui o que o cliente paga direto ao fornecedor
   * (tipos A/D), e esse dinheiro nunca passa pelo caixa da California
   * (decisão 004). É a mesma conta da "Margem prevista" do formulário de
   * abertura — decisão do Tiago em 20/08/2026, contra o que o protótipo
   * desenhava.
   *
   * Como os demais totais, soma só os jobs já abertos no financeiro.
   */
  totalMargem: number;
  /** Quantos já têm nota emitida, de quantos entram no agregado. */
  faturados: number;
  /**
   * Jobs que ainda aguardam abertura. Aparecem na lista e ficam fora de
   * todos os totais; o rodapé da tela diz quantos são.
   */
  aguardandoAbertura: number;
  /** Quantos jobs entram nas contas — o denominador dos cards. */
  jobsNoFinanceiro: number;
}

/**
 * O projeto do financeiro com os jobs dele e os totais — a tela que o
 * link "Visão agregada" abre, dentro do próprio módulo financeiro.
 *
 * Rota própria (e não `/jobs/projeto/[id]`, da produção) porque o
 * financeiro não encaminha para telas de outros módulos, e porque o
 * agrupamento aqui é o do FINANCEIRO: o mesmo projeto pode juntar jobs
 * que na produção estão em projetos diferentes.
 *
 * Devolve null quando o projeto não existe no tenant — o 404 é da página.
 */
export async function carregarProjetoFinanceiro(
  tenantId: string,
  projetoId: string,
  hoje: string = new Date().toISOString().slice(0, 10),
): Promise<ProjetoFinanceiroAgregado | null> {
  const supabase = createClient();

  const [projetoRes, jobsRes, esteira] = await Promise.all([
    supabase
      .from("projetos_financeiro")
      .select("id, codigo, nome, cliente:clientes(nome_fantasia)")
      .eq("id", projetoId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("jobs")
      .select(
        "id, codigo, nome, nome_financeiro, status, competencia_trimestre, " +
          "competencia_ano, valor_total, faturamento_previsto, " +
          "custo_previsto_total, data_abertura_financeiro",
      )
      .eq("tenant_id", tenantId)
      .eq("projeto_financeiro_id", projetoId)
      .in("status", STATUS_NO_AGREGADO as unknown as string[])
      .order("codigo", { ascending: true }),
    faturamentoPorJob(tenantId, hoje),
  ]);

  if (projetoRes.error) {
    console.error("[projeto-financeiro.carregar]", projetoRes.error.message);
    return null;
  }
  const projeto = projetoRes.data as any;
  if (!projeto) return null;

  if (jobsRes.error) {
    console.error("[projeto-financeiro.jobs]", jobsRes.error.message);
  }

  const jobs: JobDoProjetoFinanceiro[] = ((jobsRes.data ?? []) as any[]).map(
    (j) => ({
      id: j.id,
      codigo: j.codigo,
      nome: nomeDoJobNoFinanceiro(j),
      status: j.status as JobStatus,
      competencia_trimestre: j.competencia_trimestre,
      competencia_ano: j.competencia_ano,
      valor_total: Number(j.valor_total ?? 0),
      faturamento_previsto: Number(j.faturamento_previsto ?? 0),
      custo_previsto:
        j.custo_previsto_total !== null && j.custo_previsto_total !== undefined
          ? Number(j.custo_previsto_total)
          : null,
      situacao_faturamento: (esteira.get(j.id) ?? FATURAMENTO_VAZIO).situacao,
      aberto_no_financeiro: j.data_abertura_financeiro !== null,
    }),
  );

  // TODOS os totais somam apenas os jobs já abertos no financeiro. Quem
  // aguarda abertura aparece na lista, mas não entra em conta — não tem
  // linha no fluxo de caixa, e o total precisa bater com o que o
  // financeiro de fato registrou.
  const noFinanceiro = jobs.filter((j) => j.aberto_no_financeiro);
  const soma = (fn: (j: JobDoProjetoFinanceiro) => number) =>
    noFinanceiro.reduce((s, j) => s + fn(j), 0);

  const totalFaturamento = soma((j) => j.faturamento_previsto);
  const totalCusto = soma((j) => j.custo_previsto ?? 0);

  return {
    id: projeto.id,
    codigo: projeto.codigo,
    nome: projeto.nome,
    cliente_nome: projeto.cliente?.nome_fantasia ?? null,
    jobs,
    totalValor: soma((j) => j.valor_total),
    totalFaturamento,
    totalCusto,
    totalMargem: totalFaturamento - totalCusto,
    aguardandoAbertura: jobs.length - noFinanceiro.length,
    jobsNoFinanceiro: noFinanceiro.length,
    faturados: noFinanceiro.filter(
      (j) =>
        j.situacao_faturamento === "faturado" ||
        j.situacao_faturamento === "liquidado" ||
        j.situacao_faturamento === "inadimplente",
    ).length,
  };
}
