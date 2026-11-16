/**
 * Pagamentos atrasados em job encerrado ou finalizado (decisão 259).
 *
 * O financeiro libera os pagamentos atrasados num job fechado, com a
 * competência dos novos lançamentos e o motivo. Com a liberação aberta, a
 * produção gera PP em qualquer linha e cria linha vermelha; cada PP e cada
 * linha vermelha levam a marca da liberação (`pagamento_atrasado_id`, posta
 * pelo banco). Para terminar, a produção conclui (o financeiro confirma) ou o
 * financeiro conclui sozinho — e a planilha volta a travar.
 *
 * Aqui ficam o tipo da liberação, a leitura do banco e os textos que se
 * repetem nas telas. As regras moram no banco (migration 20261116600001):
 * as funções `liberar_`/`pedir_conclusao_dos_`/`cancelar_conclusao_dos_`/
 * `concluir_pagamentos_atrasados` e os gatilhos que marcam a PP e a linha.
 */

import { formatDiaBr } from "@/lib/formatar-data-hora";

/** Uma liberação, como as telas a usam. */
export interface LiberacaoPagamentosAtrasados {
  id: string;
  trimestre: number;
  ano: number;
  motivo: string;
  liberadoEm: string;
  liberadoPorNome: string | null;
  /** A produção concluiu e espera o financeiro confirmar. */
  conclusaoPedidaEm: string | null;
  conclusaoPedidaPorNome: string | null;
  /** O financeiro concluiu: a planilha voltou a travar. */
  encerradoEm: string | null;
}

/** O que a página do job sabe dos pagamentos atrasados. */
export interface PagamentosAtrasadosDoJob {
  /** A liberação não encerrada (aberta ou com a conclusão pedida). */
  atual: LiberacaoPagamentosAtrasados | null;
  /** Todas, as encerradas inclusive: nomeiam a competência das PPs e das
   *  linhas vermelhas marcadas. */
  todas: LiberacaoPagamentosAtrasados[];
  /** O job já foi faturado: o AR não recebe pagamento atrasado. */
  jaFaturado: boolean;
}

/** O que a Planilha Interna recebe da página do job: as liberações e o que
 *  a pessoa pode fazer com elas. */
export interface PagamentosAtrasadosNaPlanilha extends PagamentosAtrasadosDoJob {
  /** Produção: cria linha vermelha e conclui (`jobs.preparar_errata`). */
  podeCriarLinha: boolean;
  /** Financeiro: libera e conclui (`jobs.editar_orcado_financeiro`). */
  podeLiberar: boolean;
  /** As competências que o financeiro pode escolher e a que vem marcada
   *  (a de hoje). */
  competencias: Array<{ trimestre: number; ano: number }>;
  competenciaPadrao: { trimestre: number; ano: number };
  /** "2T/2026": o trimestre do job, para referência no pop-up. */
  competenciaDoJob: string | null;
  /** O job tem linha de custo AR (para o aviso do job já faturado). */
  temAR: boolean;
}

/** As colunas da liberação, com os nomes de quem liberou e de quem
 *  concluiu. A tabela tem três FKs para `profiles`: todo embed precisa do
 *  hint da coluna. */
export const SELECT_LIBERACAO_PAGAMENTOS_ATRASADOS = `
  id, trimestre, ano, motivo, liberado_em, conclusao_pedida_em, encerrado_em,
  liberado_por_profile:profiles!liberado_por(nome),
  conclusao_pedida_por_profile:profiles!conclusao_pedida_por(nome)
`;

/** A linha do banco (com os embeds acima) no formato das telas. */
export function liberacaoDaLinha(l: {
  id: string;
  trimestre: number;
  ano: number;
  motivo: string | null;
  liberado_em: string;
  conclusao_pedida_em: string | null;
  encerrado_em: string | null;
  liberado_por_profile?: { nome: string | null } | Array<{ nome: string | null }> | null;
  conclusao_pedida_por_profile?: { nome: string | null } | Array<{ nome: string | null }> | null;
}): LiberacaoPagamentosAtrasados {
  const nome = (p: { nome: string | null } | Array<{ nome: string | null }> | null | undefined) =>
    (Array.isArray(p) ? p[0]?.nome : p?.nome) ?? null;
  return {
    id: l.id,
    trimestre: Number(l.trimestre),
    ano: Number(l.ano),
    motivo: l.motivo ?? "",
    liberadoEm: l.liberado_em,
    liberadoPorNome: nome(l.liberado_por_profile),
    conclusaoPedidaEm: l.conclusao_pedida_em,
    conclusaoPedidaPorNome: l.conclusao_pedida_em ? nome(l.conclusao_pedida_por_profile) : null,
    encerradoEm: l.encerrado_em,
  };
}

/** "4T/26" — nos selos. */
export function competenciaCurta(trimestre: number, ano: number): string {
  return `${trimestre}T/${String(ano).slice(2)}`;
}

/** "4T/2026" — nos textos. */
export function competenciaLonga(trimestre: number, ano: number): string {
  return `${trimestre}T/${ano}`;
}

/** Aberta: a produção lança. Conclusão pedida: a produção concluiu e o
 *  financeiro confirma. Encerrada: a planilha voltou a travar. */
export function estadoDaLiberacao(
  l: LiberacaoPagamentosAtrasados | null,
): "aberta" | "conclusao_pedida" | "encerrada" | null {
  if (!l) return null;
  if (l.encerradoEm) return "encerrada";
  return l.conclusaoPedidaEm ? "conclusao_pedida" : "aberta";
}

/** Termina com um ponto só (o motivo já pode trazer o dele). */
export function frase(t: string): string {
  const s = t.trim();
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** A dica dos selos da liberação. */
export function dicaDaLiberacao(l: LiberacaoPagamentosAtrasados): string {
  const quem = l.liberadoPorNome ? ` por ${l.liberadoPorNome}` : "";
  return `Pagamentos atrasados · competência ${competenciaLonga(l.trimestre, l.ano)} · liberados${quem} em ${formatDiaBr(l.liberadoEm)}${l.motivo ? ` · motivo: ${l.motivo}` : ""}`;
}

/** A dica da marca de UMA PP de pagamento atrasado. */
export function dicaDaPPAtrasada(l: LiberacaoPagamentosAtrasados): string {
  const quem = l.liberadoPorNome ? ` por ${l.liberadoPorNome}` : "";
  return `Pagamento atrasado · competência ${competenciaLonga(l.trimestre, l.ano)} · liberado${quem} em ${formatDiaBr(l.liberadoEm)}${l.motivo ? ` · motivo: ${l.motivo}` : ""}`;
}

/** As competências que o financeiro pode escolher: do trimestre do job até
 *  o seguinte ao de hoje (no horário de Brasília). Sem trimestre no job,
 *  do trimestre de hoje ao seguinte. */
export function competenciasParaLiberar(
  job: { trimestre: number | null; ano: number | null },
  hojeIso: string,
): Array<{ trimestre: number; ano: number }> {
  const [anoHoje, mesHoje] = hojeIso.split("-").map(Number);
  const tHoje = Math.floor((mesHoje - 1) / 3) + 1;
  const fimT = tHoje === 4 ? 1 : tHoje + 1;
  const fimA = tHoje === 4 ? anoHoje + 1 : anoHoje;
  let t = job.trimestre ?? tHoje;
  let a = job.ano ?? anoHoje;
  const out: Array<{ trimestre: number; ano: number }> = [];
  for (let i = 0; i < 16; i++) {
    out.push({ trimestre: t, ano: a });
    if (t === fimT && a === fimA) break;
    t = t === 4 ? 1 : t + 1;
    if (t === 1) a += 1;
  }
  return out;
}

/** O trimestre de hoje (Brasília). */
export function trimestreDeHoje(hojeIso: string): { trimestre: number; ano: number } {
  const [ano, mes] = hojeIso.split("-").map(Number);
  return { trimestre: Math.floor((mes - 1) / 3) + 1, ano };
}

/** O tipo da PP, no painel Dados da tela da PP: Verba, Reembolso ou Cartão
 *  corporativo. A PP normal não leva o campo (nulo). Vale para toda PP. */
export function rotuloDoTipoDaPP(pp: {
  verba_producao?: boolean | null;
  tipo_verba?: string | null;
  cartao_corporativo?: boolean | null;
}): string | null {
  if (pp.verba_producao) return pp.tipo_verba === "reembolso" ? "Reembolso" : "Verba";
  return pp.cartao_corporativo ? "Cartão corporativo" : null;
}

/** O motivo do Gerar PP travado na linha AR do job já faturado. */
export const MSG_AR_JOB_FATURADO =
  "Custo AR: este job já foi faturado, e o pagamento atrasado de AR só entra em job ainda não faturado.";

/** O job fechado (encerrado ou finalizado). */
export function jobFechado(status: string | null | undefined): boolean {
  return status === "encerrado" || status === "finalizado";
}

/** A mensagem de erro do Postgres, sem o prefixo técnico. */
export function mensagemDoBanco(message: string | null | undefined, padrao: string): string {
  const m = (message ?? "").trim();
  return m || padrao;
}
