/**
 * O faturamento dos jobs do histórico (decisão 211, A4): as notas emitidas de
 * cada job das abas Res. Jobs, lidas das abas de Faturamento da planilha. É o
 * par do Faturamento de Jobs do sistema; o histórico não tem o valor
 * contratado do job, então a comparação é o faturado com o recebido.
 *   - Faturado: o valor das notas emitidas do job, em qualquer data.
 *   - Recebido: as notas com data de recebimento na planilha.
 *   - A receber: as notas sem essa data.
 * Decidido pelo Tiago em 26/10/2026.
 */
import { grupoDoJob, type VisaoDaRentabilidade } from "./rentabilidade";

export type VisaoDoFaturamento = VisaoDaRentabilidade;

/** Um job de uma aba Res. Jobs, com as notas dele no histórico. */
export type JobFaturadoDoHistorico = {
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
  /** O número de notas emitidas do job. */
  notas: number;
  faturado: number;
  /** O valor das notas com data de recebimento. */
  recebido: number;
};

export type SituacaoDoFaturamento = "sem_nota" | "a_receber" | "parcial" | "recebido";

export const ROTULO_DA_SITUACAO: Record<SituacaoDoFaturamento, string> = {
  sem_nota: "Sem nota",
  a_receber: "A receber",
  parcial: "Parcial",
  recebido: "Recebido",
};

const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * A situação do job pelas notas dele: sem nota; recebido, quando não sobra
 * nada a receber; a receber, quando nenhuma nota tem data de recebimento; e
 * parcial no meio.
 */
export function situacaoDoJob(job: Pick<JobFaturadoDoHistorico, "notas" | "faturado" | "recebido">): SituacaoDoFaturamento {
  if (job.notas === 0) return "sem_nota";
  if (centavos(job.faturado - job.recebido) <= 0) return "recebido";
  if (centavos(job.recebido) <= 0) return "a_receber";
  return "parcial";
}

export type LinhaDoFaturamento = {
  chave: string;
  rotulo: string;
  /** Na visão por job, o cliente e a marca; nas outras, nulo. */
  detalhe: string | null;
  jobs: number;
  notas: number;
  faturado: number;
  recebido: number;
  aReceber: number;
  /** Na visão por job, a situação dele; nas outras, nula. */
  situacao: SituacaoDoFaturamento | null;
};

export type FaturamentoDosJobs = {
  linhas: LinhaDoFaturamento[];
  total: LinhaDoFaturamento;
  /** Os jobs sem nota emitida no histórico. */
  semNota: number;
};

function somar(chave: string, rotulo: string, detalhe: string | null, jobs: readonly JobFaturadoDoHistorico[]): LinhaDoFaturamento {
  let notas = 0;
  let faturado = 0;
  let recebido = 0;
  for (const j of jobs) {
    notas += j.notas;
    faturado += centavos(j.faturado);
    recebido += centavos(j.recebido);
  }
  return {
    chave,
    rotulo,
    detalhe,
    jobs: jobs.length,
    notas,
    faturado: centavos(faturado),
    recebido: centavos(recebido),
    aReceber: centavos(faturado - recebido),
    situacao: null,
  };
}

/**
 * Os jobs de uma empresa num ano (já filtrados pelo período), agrupados por
 * cliente, marca ou job, do maior faturado para o menor. O job sem nota entra
 * com zero, para o total de jobs ser o mesmo nas três visões.
 */
export function montarFaturamento(jobs: readonly JobFaturadoDoHistorico[], visao: VisaoDoFaturamento): FaturamentoDosJobs {
  const grupos = new Map<string, { rotulo: string; detalhe: string | null; jobs: JobFaturadoDoHistorico[] }>();
  for (const j of jobs) {
    const g = grupoDoJob(j, visao);
    const atual = grupos.get(g.chave) ?? { rotulo: g.rotulo, detalhe: g.detalhe, jobs: [] };
    atual.jobs.push(j);
    grupos.set(g.chave, atual);
  }
  const linhas = [...grupos.entries()]
    .map(([chave, g]) => {
      const l = somar(chave, g.rotulo, g.detalhe, g.jobs);
      return visao === "job" ? { ...l, situacao: situacaoDoJob(l) } : l;
    })
    .sort((a, b) => b.faturado - a.faturado || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  return {
    linhas,
    total: somar("total", "Total", null, jobs),
    semNota: jobs.filter((j) => j.notas === 0).length,
  };
}
