/**
 * A conta do "Editar orçado" do financeiro (decisão 115), num lugar só: o
 * pop-up mostra o antes → depois com estas funções e a action grava com as
 * mesmas, para a tela nunca prometer um número que o servidor não grava.
 *
 * Funções puras: quem chama traz as linhas e as parcelas.
 */

import type { ItemPlanilhaJob, TipoCusto } from "@/lib/types";
import { tipoGeraDesembolso } from "@/lib/calculos/versao-totais";

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
  tipoCustoDe: TipoCusto;
  tipoCustoPara: TipoCusto;
  valorUnitarioDe: number;
  valorUnitarioPara: number;
  quantidadeDe: number;
  quantidadePara: number;
  diasMesesDe: number;
  diasMesesPara: number;
  totalDe: number;
  totalPara: number;
  /** O planejado da linha, que a edição não muda (só no Interno, em que o
   *  banco o faz espelhar o orçado). É ele que entra no custo previsto
   *  quando o tipo gera PP. */
  planejadoDe: number;
  planejadoPara: number;
}

/**
 * Quanto o custo previsto do job (o planejado dos tipos que geram PP,
 * decisão 004) muda com a edição. A curva de desembolso não acompanha
 * (decisão 115): o pop-up avisa, para o financeiro ajustá-la no Editar
 * registro. Muda quando o tipo entra ou sai dos tipos com PP, e no Interno,
 * em que o planejado segue o orçado.
 */
export function deltaDoCustoPrevisto(linhas: LinhaAlteradaPeloFinanceiro[]): number {
  return emReais(
    linhas.reduce(
      (s, l) =>
        s +
        (tipoGeraDesembolso(l.tipoCustoPara) ? l.planejadoPara : 0) -
        (tipoGeraDesembolso(l.tipoCustoDe) ? l.planejadoDe : 0),
      0,
    ),
  );
}

/**
 * As linhas que a edição mexeu, comparando o rascunho com o que está
 * salvo. Contam os três valores do orçado (P1) e, desde 08/10/2026, o tipo
 * de custo; o planejado não é do financeiro.
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
    if (
      unitDe === unitPara &&
      qtdDe === qtdPara &&
      dmDe === dmPara &&
      de.tipo_custo === para.tipo_custo
    ) {
      continue;
    }
    lista.push({
      id: de.id,
      item: de.item,
      grupoId: de.grupo_id,
      tipoCustoDe: de.tipo_custo,
      tipoCustoPara: para.tipo_custo,
      valorUnitarioDe: unitDe,
      valorUnitarioPara: unitPara,
      quantidadeDe: qtdDe,
      quantidadePara: qtdPara,
      diasMesesDe: dmDe,
      diasMesesPara: dmPara,
      totalDe: Number(de.total_orcado ?? 0),
      totalPara: unitPara * qtdPara * dmPara,
      planejadoDe: Number(de.total_planejado ?? 0),
      planejadoPara: Number(para.total_planejado ?? 0),
    });
  }
  return lista;
}

/**
 * O que já foi lançado numa linha do job, para a troca de tipo de custo no
 * "Editar orçado" do financeiro (revisão da decisão 115, 08/10/2026): o
 * Tiago pediu que, "do mesmo modo que com a realização de erratas, só será
 * possível realizar modificações enquanto nada tiver sido adicionado no
 * item". PP de qualquer situação, PP a emitir e BV contam; cancelados, não.
 * É o mesmo recorte de `lancamentos_nas_linhas_do_job`, no banco.
 */
export type LancamentoNaLinha = "pp" | "pp_a_emitir" | "bv";

export function lancamentoNaLinha(linha: {
  /** Status das PPs da linha. */
  pps: ReadonlyArray<{ status: string }>;
  /** PPs a emitir ainda abertas (decisão 153). */
  aEmitir: number;
  /** Situação dos BVs da linha. */
  bvs: ReadonlyArray<{ situacao: string }>;
}): LancamentoNaLinha | null {
  if (linha.pps.some((pp) => pp.status !== "cancelada")) return "pp";
  if (linha.aEmitir > 0) return "pp_a_emitir";
  if (linha.bvs.some((bv) => bv.situacao !== "cancelado")) return "bv";
  return null;
}

const NOME_DO_LANCAMENTO: Record<LancamentoNaLinha, string> = {
  pp: "Pedido de Produção",
  pp_a_emitir: "PP a emitir",
  bv: "BV",
};

/** Por que o tipo de custo da linha não abre. Com o nome do item, é a
 *  recusa da action; sem ele, o `title` da célula na planilha. */
export function motivoDoTipoTravado(lancamento: LancamentoNaLinha, item?: string): string {
  const nome = NOME_DO_LANCAMENTO[lancamento];
  return item
    ? `"${item}" já tem ${nome}: o tipo de custo só muda enquanto nada foi lançado no item. Os valores do orçado continuam editáveis.`
    : `Linha com ${nome}: o tipo de custo só muda enquanto nada foi lançado no item. Os valores do orçado continuam editáveis.`;
}
