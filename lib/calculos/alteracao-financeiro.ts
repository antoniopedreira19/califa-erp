/**
 * A conta do "Editar orçado" do financeiro (decisão 115), num lugar só: o
 * pop-up mostra o antes → depois com estas funções e a action grava com as
 * mesmas, para a tela nunca prometer um número que o servidor não grava.
 *
 * Funções puras: quem chama traz as linhas e as parcelas.
 */

import type { ItemPlanilhaJob, TipoCusto } from "@/lib/types";

/** Dinheiro sempre com 2 casas, como `jobs.valor_total`. */
export function emReais(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Soma `delta` às linhas, na proporção do valor de cada uma; a última fecha
 * o centavo. Quando as parcelas já fechavam com o total antigo, é o mesmo
 * que reescalá-las para o total novo, com as datas de hoje (P3 do Tiago,
 * 28/09/2026). Quando não fechavam (dado antigo), a diferença que havia
 * continua lá — a conta não apaga o que ninguém pediu para apagar.
 */
export function distribuirDelta<T extends { valor: number }>(
  linhas: T[],
  delta: number,
): T[] {
  if (linhas.length === 0 || Math.abs(delta) < 0.005) return linhas;
  const soma = linhas.reduce((s, l) => s + l.valor, 0);
  let restante = emReais(delta);
  return linhas.map((l, i) => {
    const parte =
      i === linhas.length - 1
        ? restante
        : emReais(soma > 0 ? (delta * l.valor) / soma : delta / linhas.length);
    restante = emReais(restante - parte);
    return { ...l, valor: emReais(l.valor + parte) };
  });
}

/** Uma linha cujo orçado o financeiro mudou: o de e o para. */
export interface LinhaAlteradaPeloFinanceiro {
  id: string;
  item: string;
  grupoId: string;
  tipoCusto: TipoCusto;
  valorUnitarioDe: number;
  valorUnitarioPara: number;
  quantidadeDe: number;
  quantidadePara: number;
  diasMesesDe: number;
  diasMesesPara: number;
  totalDe: number;
  totalPara: number;
}

/**
 * As linhas que a edição mexeu, comparando o rascunho com o que está
 * salvo. Só os três valores do orçado contam (P1): tipo e planejado não
 * são do financeiro.
 */
export function linhasAlteradasPeloFinanceiro(
  salvos: ItemPlanilhaJob[],
  rascunho: ItemPlanilhaJob[],
): LinhaAlteradaPeloFinanceiro[] {
  const porId = new Map(rascunho.map((i) => [i.id, i]));
  const lista: LinhaAlteradaPeloFinanceiro[] = [];
  for (const de of salvos) {
    const para = porId.get(de.id);
    if (!para) continue;
    const unitDe = Number(de.valor_unitario_orcado ?? 0);
    const qtdDe = Number(de.quantidade_orcada ?? 0);
    const dmDe = Number(de.dias_meses_orcado ?? 0);
    const unitPara = Number(para.valor_unitario_orcado ?? 0);
    const qtdPara = Number(para.quantidade_orcada ?? 0);
    const dmPara = Number(para.dias_meses_orcado ?? 0);
    if (unitDe === unitPara && qtdDe === qtdPara && dmDe === dmPara) continue;
    lista.push({
      id: de.id,
      item: de.item,
      grupoId: de.grupo_id,
      tipoCusto: de.tipo_custo,
      valorUnitarioDe: unitDe,
      valorUnitarioPara: unitPara,
      quantidadeDe: qtdDe,
      quantidadePara: qtdPara,
      diasMesesDe: dmDe,
      diasMesesPara: dmPara,
      totalDe: Number(de.total_orcado ?? 0),
      totalPara: unitPara * qtdPara * dmPara,
    });
  }
  return lista;
}
