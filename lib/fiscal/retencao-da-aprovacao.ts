/**
 * As retenções na fonte que o financeiro decidiu na APROVAÇÃO da PP, no
 * formato em que a baixa da parcela as usa (módulo fiscal, entrega 1 —
 * 02/10/2026).
 *
 * A aprovação grava as alíquotas em `pedidos_compra_retencoes` (pela função
 * `registrar_nf_da_pp`). A baixa de uma parcela daquela PP abre com elas: a
 * chave "Reter impostos na fonte" ligada e as alíquotas preenchidas,
 * editáveis — e grava o que de fato reteve em `baixas_retencoes`, como
 * sempre. Sem alíquota gravada, a baixa abre como antes (em branco).
 *
 * Só funções puras: a leitura mora em
 * `app/(app)/financeiro/contas-a-pagar/actions-retencao-da-aprovacao.ts` e
 * o estado da tela em `components/financeiro/retencao-da-aprovacao.ts`.
 * Testes: node --import tsx --test lib/fiscal/retencao-da-aprovacao.test.ts
 */

import { formatBRL } from "@/lib/format";
import { IMPOSTOS_RETIDOS, type ImpostoRetido } from "@/lib/types";
import { dataBr } from "./datas";

export interface RetencaoDaAprovacao {
  /** O dia da aprovação ("AAAA-MM-DD", no fuso de Brasília), para a linha
   *  "Retenções informadas na aprovação da PP (20/10/2026)". Nulo se a PP
   *  não guardou nenhuma das datas. */
  data: string | null;
  /** Só os impostos com alíquota (> 0), em %. */
  aliquotas: Partial<Record<ImpostoRetido, number>>;
  /**
   * Decisão 145: a parcela está numa remessa CNAB que pagou o líquido. As
   * alíquotas são as que a remessa descontou, e o líquido da baixa tem de
   * ser o que o banco pagou (o banco de dados confere). `null` fora disso.
   */
  remessa: { liquido: number } | null;
}

/**
 * A parcela de PP de um título a pagar, pela chave que a lista de Títulos a
 * Pagar monta para a baixa: `${origem}-${id do título}-${nº de baixas}`, e
 * o id do título de origem "pp" é o da parcela (`pedidos_compra_parcelas`).
 * Qualquer outra origem — inclusive `pp_devolucao_verba` — devolve `null`.
 */
const CHAVE_DE_PARCELA_DE_PP =
  /^pp-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-\d+$/i;

export function parcelaDePPDaChave(chave: string): string | null {
  const m = CHAVE_DE_PARCELA_DE_PP.exec(chave);
  return m ? m[1].toLowerCase() : null;
}

/** O dia de um instante no fuso de Brasília: o servidor da Vercel roda em
 *  UTC, e a aprovação das 22h de 20/10 seria "21/10" sem o fuso. */
export function diaEmSaoPaulo(instante: string | null | undefined): string | null {
  if (!instante) return null;
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * As linhas de `pedidos_compra_retencoes` no formato da baixa. A alíquota
 * chega do PostgREST como número ou como texto (`numeric`); imposto fora da
 * lista e alíquota zerada ficam de fora. Sem nenhuma alíquota, `null`: a
 * PP foi aprovada sem retenção, e a baixa abre como sempre abriu.
 */
export function montarRetencaoDaAprovacao(
  linhas: ReadonlyArray<{ imposto: string; aliquota: number | string | null }>,
  data: string | null,
): RetencaoDaAprovacao | null {
  const aliquotas: Partial<Record<ImpostoRetido, number>> = {};
  for (const { imposto } of IMPOSTOS_RETIDOS) {
    const linha = linhas.find((l) => l.imposto === imposto);
    const aliquota = linha ? Number(linha.aliquota) : NaN;
    if (Number.isFinite(aliquota) && aliquota > 0) aliquotas[imposto] = aliquota;
  }
  if (Object.keys(aliquotas).length === 0) return null;
  return { data, aliquotas, remessa: null };
}

/** "Retenções informadas na aprovação da PP (20/10/2026) · editáveis" — a
 *  ajuda ao lado da chave de retenção, na baixa. */
export function textoDaRetencaoDaAprovacao(r: RetencaoDaAprovacao): string {
  if (r.remessa)
    return `Retenção da aprovação, descontada na remessa: o banco pagou ${formatBRL(r.remessa.liquido)} · a baixa repete esse líquido`;
  return r.data
    ? `Retenções informadas na aprovação da PP (${dataBr(r.data)}) · editáveis`
    : "Retenções informadas na aprovação da PP · editáveis";
}
