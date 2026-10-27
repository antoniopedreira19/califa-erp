/**
 * A rentabilidade dos jobs do histórico (decisão 211, A4): as contas das abas
 * Res. Jobs da planilha, refeitas dos lançamentos e das notas do histórico.
 *   - O resultado é a receita do job menos o imposto das notas dele e o custo
 *     (as colunas TOTAL RECEITA, IMPOSTO, TOTAL CO e RESULTADO), como o
 *     Result. Op do relatório de Rentabilidade de Jobs.
 *   - O fee líquido é o que a planilha separa por dentro da receita menos o
 *     imposto, supondo que ela já traz o fee do job: (receita − imposto) × fee
 *     ÷ (1 + fee), com o percentual de cada job (12% na California, 15% na
 *     CCH). Não é o honorário orçado.
 *   - A rentabilidade é o resultado menos o fee líquido.
 * Vale só para os dados históricos importados: os jobs novos seguem os
 * honorários das planilhas internas.
 */
import { normalizarTexto } from "./regras";

/** Um job de uma aba Res. Jobs, com as somas do histórico. */
export type JobDoHistorico = {
  chave: string;
  nome: string;
  empresa: string;
  /** A coluna T da aba ("1T" a "4T"). */
  trimestre: string | null;
  clienteId: string | null;
  /** O nome do cliente no sistema, ou o texto da planilha. */
  cliente: string | null;
  marcaId: string | null;
  marca: string | null;
  /** O percentual de fee do job, em fração (0.12); nulo quando a planilha não tem. */
  feePercentual: number | null;
  receita: number;
  imposto: number;
  custo: number;
};

export type VisaoDaRentabilidade = "cliente" | "marca" | "job";

export type ContasDoJob = {
  receita: number;
  imposto: number;
  custo: number;
  resultado: number;
  fee: number;
  rentabilidade: number;
};

const centavos = (v: number) => Math.round(v * 100) / 100;
const pct = (parte: number, todo: number) => (todo > 0 ? (parte / todo) * 100 : null);

/**
 * As contas de um job, como as colunas da aba Res. Jobs. A receita, o imposto e
 * o custo entram em centavos: a soma em ponto flutuante deixa resto que, no
 * fee, muda o centavo do arredondamento.
 */
export function contasDoJob(job: Pick<JobDoHistorico, "receita" | "imposto" | "custo" | "feePercentual">): ContasDoJob {
  const [receita, imposto, custo] = [job.receita, job.imposto, job.custo].map(centavos);
  const resultado = centavos(receita - imposto - custo);
  const fee = job.feePercentual ? ((receita - imposto) * job.feePercentual) / (1 + job.feePercentual) : 0;
  return { receita, imposto, custo, resultado, fee, rentabilidade: resultado - fee };
}

export type LinhaDaRentabilidade = ContasDoJob & {
  chave: string;
  rotulo: string;
  /** Na visão por job, o cliente e a marca; nas outras, nulo. */
  detalhe: string | null;
  jobs: number;
  /** O resultado e a rentabilidade sobre a receita, em %; nulos sem receita. */
  resultadoPct: number | null;
  rentabilidadePct: number | null;
  /** A parte da receita do grupo na receita do período, em %. */
  representatividadePct: number | null;
};

export type RentabilidadeDosJobs = {
  linhas: LinhaDaRentabilidade[];
  total: LinhaDaRentabilidade;
  /** Os jobs sem percentual de fee na planilha: o fee deles fica zero. */
  semFee: number;
};

/**
 * A chave e o rótulo do grupo de um job: o cadastro do sistema, ou o texto da
 * planilha. O faturamento dos jobs do histórico agrupa do mesmo jeito.
 */
export function grupoDoJob(
  job: Pick<JobDoHistorico, "chave" | "nome" | "clienteId" | "cliente" | "marcaId" | "marca">,
  visao: VisaoDaRentabilidade,
): { chave: string; rotulo: string; detalhe: string | null } {
  if (visao === "job") {
    return { chave: job.chave, rotulo: job.nome, detalhe: [job.cliente, job.marca].filter(Boolean).join(" · ") || null };
  }
  const id = visao === "cliente" ? job.clienteId : job.marcaId;
  const texto = visao === "cliente" ? job.cliente : job.marca;
  if (id) return { chave: id, rotulo: texto ?? id, detalhe: null };
  if (texto && normalizarTexto(texto)) return { chave: `planilha:${normalizarTexto(texto)}`, rotulo: texto, detalhe: null };
  return { chave: "sem", rotulo: visao === "cliente" ? "(sem cliente)" : "(sem marca)", detalhe: null };
}

function somar(chave: string, rotulo: string, detalhe: string | null, jobs: readonly JobDoHistorico[]): LinhaDaRentabilidade {
  const soma: ContasDoJob = { receita: 0, imposto: 0, custo: 0, resultado: 0, fee: 0, rentabilidade: 0 };
  for (const j of jobs) {
    const c = contasDoJob(j);
    for (const k of Object.keys(soma) as (keyof ContasDoJob)[]) soma[k] += c[k];
  }
  const arredondado = Object.fromEntries(Object.entries(soma).map(([k, v]) => [k, centavos(v)])) as ContasDoJob;
  return {
    chave,
    rotulo,
    detalhe,
    jobs: jobs.length,
    ...arredondado,
    resultadoPct: pct(soma.resultado, soma.receita),
    rentabilidadePct: pct(soma.rentabilidade, soma.receita),
    representatividadePct: null,
  };
}

/**
 * Os jobs de uma empresa num ano (já filtrados pelo período), agrupados por
 * cliente, marca ou job, da maior receita para a menor. O job sem cliente ou
 * sem marca entra num grupo próprio, para o total ser o mesmo nas três visões.
 */
export function montarRentabilidade(jobs: readonly JobDoHistorico[], visao: VisaoDaRentabilidade): RentabilidadeDosJobs {
  const grupos = new Map<string, { rotulo: string; detalhe: string | null; jobs: JobDoHistorico[] }>();
  for (const j of jobs) {
    const g = grupoDoJob(j, visao);
    const atual = grupos.get(g.chave) ?? { rotulo: g.rotulo, detalhe: g.detalhe, jobs: [] };
    atual.jobs.push(j);
    grupos.set(g.chave, atual);
  }
  const total = somar("total", "Total", null, jobs);
  const linhas = [...grupos.entries()]
    .map(([chave, g]) => {
      const l = somar(chave, g.rotulo, g.detalhe, g.jobs);
      return { ...l, representatividadePct: pct(l.receita, total.receita) };
    })
    .sort((a, b) => b.receita - a.receita || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  return {
    linhas,
    total: { ...total, representatividadePct: total.receita > 0 ? 100 : null },
    semFee: jobs.filter((j) => j.feePercentual === null).length,
  };
}
