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
  /** O planejado da linha. Muda com o job na fila da abertura (revisão de
   *  14/10/2026) e no Interno, em que o banco o faz espelhar o orçado;
   *  depois da abertura, fica. É ele que entra no custo previsto quando o
   *  tipo gera PP. */
  planejadoDe: number;
  planejadoPara: number;
  planUnitarioDe: number;
  planUnitarioPara: number;
  planQuantidadeDe: number;
  planQuantidadePara: number;
  planDiasMesesDe: number;
  planDiasMesesPara: number;
}

/** A linha mudou o planejado — R$ Unit., QT ou D/M. */
export function planejadoMudou(l: LinhaAlteradaPeloFinanceiro): boolean {
  return (
    l.planUnitarioDe !== l.planUnitarioPara ||
    l.planQuantidadeDe !== l.planQuantidadePara ||
    l.planDiasMesesDe !== l.planDiasMesesPara
  );
}

/**
 * Quanto o custo previsto do job (o planejado dos tipos que geram PP,
 * decisão 004) muda com a edição. A curva de desembolso não acompanha
 * (decisão 115): o pop-up avisa, para o financeiro ajustá-la no Editar
 * registro. Muda quando o tipo entra ou sai dos tipos com PP, quando o
 * planejado de uma linha com PP muda (na fila da abertura) e no Interno, em
 * que o planejado segue o orçado.
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
 * salvo. Contam os três valores do orçado (P1), desde 08/10/2026 o tipo de
 * custo e, desde 14/10/2026, os três do planejado — que o rascunho só deixa
 * mudar com o job na fila da abertura. No Interno o planejado anda com o
 * orçado, e a linha já conta pelo orçado.
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
    const planUnitDe = Number(de.valor_unitario_planejado ?? 0);
    const planQtdDe = Number(de.quantidade_planejada ?? 0);
    const planDmDe = Number(de.dias_meses_planejado ?? 0);
    const planUnitPara = Number(para.valor_unitario_planejado ?? 0);
    const planQtdPara = Number(para.quantidade_planejada ?? 0);
    const planDmPara = Number(para.dias_meses_planejado ?? 0);
    if (
      unitDe === unitPara &&
      qtdDe === qtdPara &&
      dmDe === dmPara &&
      de.tipo_custo === para.tipo_custo &&
      planUnitDe === planUnitPara &&
      planQtdDe === planQtdPara &&
      planDmDe === planDmPara
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
      planUnitarioDe: planUnitDe,
      planUnitarioPara: planUnitPara,
      planQuantidadeDe: planQtdDe,
      planQuantidadePara: planQtdPara,
      planDiasMesesDe: planDmDe,
      planDiasMesesPara: planDmPara,
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
 * É o mesmo recorte de `travas_do_tipo_nas_linhas_do_job`, no banco.
 */
export type LancamentoNaLinha = "pp" | "pp_a_emitir" | "bv";

/** O que a linha tem lançado, cada coisa à parte: a linha com PP e BV
 *  trava pelo BV, e a só com PP abre entre os tipos com PP. */
export interface LancamentosDaLinha {
  pp: boolean;
  ppAEmitir: boolean;
  bv: boolean;
}

export function lancamentosDaLinha(linha: {
  /** Status das PPs da linha. */
  pps: ReadonlyArray<{ status: string }>;
  /** PPs a emitir ainda abertas (decisão 153). */
  aEmitir: number;
  /** Situação dos BVs da linha. */
  bvs: ReadonlyArray<{ situacao: string }>;
}): LancamentosDaLinha {
  return {
    pp: linha.pps.some((pp) => pp.status !== "cancelada"),
    ppAEmitir: linha.aEmitir > 0,
    bv: linha.bvs.some((bv) => bv.situacao !== "cancelado"),
  };
}

/**
 * Até onde o tipo de custo da linha muda no "Editar orçado" (revisão da
 * decisão 115, 28/10/2026). O Tiago liberou a linha com PP — inclusive a que
 * já está no financeiro —, mas só entre os tipos que geram PP: a PP emitida
 * continua fazendo sentido numa linha AR, B, C, F ou FI, e não numa A ou D,
 * em que o cliente paga o fornecedor direto. O BV segue travando: ele só
 * existe em A, AR e D, e não se resolve por efeito colateral.
 *
 * - `livre`: nada lançado, qualquer tipo;
 * - `so_com_pp`: PP ou PP a emitir, só os tipos com PP;
 * - `travado`: BV, ou PP numa linha que hoje não é tipo com PP (dado
 *   antigo — o banco não deixa nascer PP em A ou D).
 */
export type TravaDoTipo =
  | { tipo: "livre" }
  | { tipo: "so_com_pp"; lancamento: "pp" | "pp_a_emitir" }
  | { tipo: "travado"; lancamento: LancamentoNaLinha };

export function travaDoTipo(tipoAtual: TipoCusto, l: LancamentosDaLinha): TravaDoTipo {
  if (l.bv) return { tipo: "travado", lancamento: "bv" };
  const lancamento = l.pp ? "pp" : l.ppAEmitir ? "pp_a_emitir" : null;
  if (!lancamento) return { tipo: "livre" };
  return tipoGeraDesembolso(tipoAtual)
    ? { tipo: "so_com_pp", lancamento }
    : { tipo: "travado", lancamento };
}

/** A troca de `de` para `para` passa pela trava da linha? */
export function trocaDeTipoPermitida(trava: TravaDoTipo, para: TipoCusto): boolean {
  if (trava.tipo === "livre") return true;
  if (trava.tipo === "travado") return false;
  return tipoGeraDesembolso(para);
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

/** Por que a linha com PP não vai para o tipo escolhido: só entre os tipos
 *  com PP. Com o nome do item, é a recusa da action; sem ele, o `title`. */
export function motivoDoTipoSoComPP(
  lancamento: "pp" | "pp_a_emitir",
  item?: string,
): string {
  const nome = NOME_DO_LANCAMENTO[lancamento];
  const regra =
    "o tipo de custo só muda entre os tipos que geram PP (A · Repasse, B, C, F · Externo e F · Interno).";
  return item ? `"${item}" já tem ${nome}: ${regra}` : `Linha com ${nome}: ${regra}`;
}

/** A frase da recusa para a trava da linha, ou `null` quando a troca passa. */
export function motivoDaTrocaRecusada(
  trava: TravaDoTipo,
  para: TipoCusto,
  item?: string,
): string | null {
  if (trocaDeTipoPermitida(trava, para)) return null;
  if (trava.tipo === "so_com_pp") return motivoDoTipoSoComPP(trava.lancamento, item);
  if (trava.tipo === "travado") return motivoDoTipoTravado(trava.lancamento, item);
  return null;
}
