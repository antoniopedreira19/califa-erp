import type { JobStatus, OrcamentoStatus } from "@/lib/types";

/**
 * Funil comercial do orçamento — fonte única das DUAS leituras:
 *
 * - a lista de projetos (`/orcamentos`) CONTA orçamentos por estágio nas
 *   colunas Aprovados / Enviados / Abertos;
 * - o detalhe do projeto (`/orcamentos/[projetoId]`) mostra o estágio como
 *   badge por linha.
 *
 * Semântica definida pelo Tiago (16-17/08/2026), mutuamente exclusiva —
 * cada orçamento está em exatamente um estágio, segundo a situação ATUAL:
 *
 * - `orcamento` — em negociação (rascunho, em revisão, enviado ao cliente)
 *   ou recusado pelo cliente (recusa volta ao estágio de orçamento em
 *   aberto; não tem coluna própria no funil).
 * - `aprovado` — aprovado sem job ainda, OU job rejeitado pelo financeiro
 *   (a rejeição devolve o orçamento a este estágio até novo envio).
 * - `enviado` — job aguardando abertura pelo financeiro.
 * - `aberto` — job foi aberto. O que acontece depois (produção,
 *   encerramento) é assunto do módulo Jobs e não muda este estágio.
 * - `cancelado` — orçamento cancelado ou job cancelado. Fora do funil:
 *   conta só no total.
 */
export type EstagioFunil =
  | "orcamento"
  | "aprovado"
  | "enviado"
  | "aberto"
  | "cancelado";

export function estagioFunil(
  orcStatus: OrcamentoStatus,
  jobStatus: JobStatus | null,
): EstagioFunil {
  if (orcStatus === "cancelado") return "cancelado";
  if (orcStatus === "aprovado") return "aprovado";
  if (orcStatus !== "job_criado") return "orcamento";

  // Daqui pra baixo o orçamento é job_criado: o estágio é o do job.
  switch (jobStatus) {
    case "rejeitado_financeiro":
      return "aprovado";
    case "aguardando_abertura":
      return "enviado";
    case "aberto":
    case "em_producao":
    case "encerrado":
      return "aberto";
    case "cancelado":
      return "cancelado";
    default:
      // job_criado sem job encontrado é anomalia de dado; o último fato
      // conhecido do funil é a aprovação, então o orçamento volta pra lá.
      return "aprovado";
  }
}

export function estagioFunilLabel(estagio: EstagioFunil): string {
  switch (estagio) {
    case "orcamento":
      return "Orçamento";
    case "aprovado":
      return "Orçamento Aprovado";
    case "enviado":
      return "Enviado para abertura";
    case "aberto":
      return "Job Aberto";
    case "cancelado":
      return "Cancelado";
  }
}

/** Classes de badge por estágio — paleta das listas de orçamento (não são
 *  cores de bloco de planilha, então `_planilha/blocos.ts` não se aplica). */
export function estagioFunilBadgeClasses(estagio: EstagioFunil): string {
  switch (estagio) {
    case "orcamento":
      return "bg-muted text-muted-foreground border-border";
    case "aprovado":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "enviado":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "aberto":
      return "bg-california-red/10 text-california-red border-california-red/20";
    case "cancelado":
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

/**
 * Escolhe o job que representa o orçamento no funil quando houver mais de
 * um vinculado (não deveria no fluxo atual): o NÃO-cancelado mais recente;
 * só com todos cancelados vale o cancelado mais recente.
 */
export function escolherJobDoFunil(
  jobs: Array<{ status: JobStatus; created_at: string }>,
): JobStatus | null {
  if (jobs.length === 0) return null;
  const ordenados = [...jobs].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  const ativo = ordenados.find((j) => j.status !== "cancelado");
  return (ativo ?? ordenados[0]).status;
}
