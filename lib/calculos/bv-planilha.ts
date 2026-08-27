/**
 * O BV dentro da planilha — imposto, valor líquido e as duas vistas.
 *
 * Até 21/08/2026 o BV era um registro paralelo: existia em `itens_bv`,
 * aparecia no formulário e não mexia em número nenhum da planilha. Agora
 * ele participa da conta, e participa em DUAS leituras da mesma tela:
 *
 * - **Bruto** — o custo cheio, como sempre foi. É o padrão.
 * - **Líquido (− BV)** — o custo sem a comissão que volta para a
 *   California. É o número que o financeiro persegue.
 *
 * A chave que alterna as duas é uma por página (job e orçamento) e mexe
 * só em PLANEJADO e REALIZADO: o ORÇADO não recebe BV e é idêntico nos
 * dois modos.
 *
 * O que se subtrai é **sempre o líquido** — valor do BV menos o imposto
 * da alíquota do job. O bruto nunca entra na planilha: a parte que vira
 * imposto não volta para a agência.
 *
 * Fonte única das contas: tela, server action e export leem daqui.
 */

import type { BvSituacao, TipoCusto } from "@/lib/types";
import { tipoGeraDesembolso } from "./versao-totais";

/** Centavo é a menor unidade — mesma regra de `pps-item.ts`. */
function arredondar(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Qual das duas leituras da planilha está ativa. */
export type VisaoBv = "bruto" | "liquido";

export const VISAO_BV_PADRAO: VisaoBv = "bruto";

/**
 * Imposto sobre o BV: multiplicação direta pela alíquota do job.
 *
 * NÃO é o gross-up do fechamento da versão (`base × t / (1 − t)`). Lá a
 * agência precisa faturar bruto o bastante para sobrar a base líquida;
 * aqui o valor do BV já é o bruto negociado com o fornecedor, e o imposto
 * é uma fatia dele. Do design "Job - A com Repasse - BV e PP", tela 4a:
 * R$ 10.000,00 a 19,54% dá R$ 1.954,00, e não R$ 2.428,52.
 *
 * A alíquota sai de `versoes_orcamento.percentual_imposto`. Versão
 * aprovada é read-only inteira, então ela já não se move depois da
 * abertura do job — não há snapshot a guardar.
 */
export function impostoDoBv(
  valorBv: number,
  percentualImposto: number,
): number {
  const taxa = Math.max(0, Math.min(1, Number(percentualImposto ?? 0) / 100));
  return arredondar(Number(valorBv ?? 0) * taxa);
}

/** O que de fato volta para a California — e o único número que a
 *  planilha subtrai. */
export function bvLiquido(valorBv: number, percentualImposto: number): number {
  return arredondar(
    Number(valorBv ?? 0) - impostoDoBv(valorBv, percentualImposto),
  );
}

/**
 * BVs que contam no PLANEJADO: todos os ativos.
 *
 * O planejado é projeção — a comissão ainda em negociação já conta,
 * porque é ela que o GP considerou ao montar o custo. Só o cancelado
 * sai, e ele já nem chega às telas (as páginas carregam apenas ativos).
 */
export function bvContaNoPlanejado(situacao: BvSituacao): boolean {
  return situacao !== "cancelado";
}

/**
 * BVs que contam no REALIZADO: só a partir de `confirmado`.
 *
 * Realizado é o que aconteceu. Enquanto o BV está `a_negociar` ele é
 * intenção, e a linha mostra "BV não emitido" em vez de deduzir. Na
 * confirmação o BV vai ao financeiro e a dedução se materializa.
 */
export function bvContaNoRealizado(situacao: BvSituacao): boolean {
  return situacao === "confirmado" || situacao === "recebido";
}

/**
 * O planejado do item é digitado, ou é espelho do orçado?
 *
 * `A` e `D` são os tipos em que o cliente paga o fornecedor diretamente
 * (calha BV, sem Pedido de Produção). Neles a agência não escolhe um
 * custo próprio: o custo É o orçado, e o que ela ganha é a comissão. Por
 * isso o planejado deixou de ser editável neles em 21/08/2026 e passou a
 * espelhar o orçado, com o BV descontado na vista Líquido.
 *
 * `AR` fica de fora de propósito: nele o principal passa pela California
 * e é repassado ao fornecedor, então há um custo próprio a planejar — e
 * ele continua digitado, como em B, C, F e FI.
 */
export function planejadoEspelhaOrcado(tipo: TipoCusto): boolean {
  return !tipoGeraDesembolso(tipo);
}

/**
 * O realizado do item vem das PPs, ou é espelho do orçado?
 *
 * Mesma divisa do planejado, pelo mesmo motivo: quem não gera Pedido de
 * Produção (`A` e `D`) não tem de onde tirar um realizado — o custo saiu
 * do bolso do cliente, no valor orçado. Os demais tipos têm o realizado
 * montado fatia a fatia pelas PPs emitidas.
 */
export function realizadoVemDasPPs(tipo: TipoCusto): boolean {
  return tipoGeraDesembolso(tipo);
}

/**
 * Planejado BRUTO do item — o custo cheio, antes do BV.
 *
 * Em `A` e `D` é o próprio orçado; nos demais é o que foi digitado na
 * coluna PLANEJADO.
 *
 * `emSave` vem antes de tudo: a linha em save é venda sem execução, e não
 * tem custo nenhum neste job (decisão 023 §9). O trigger já grava zero nas
 * três células do planejado, mas em `A` e `D` a tela não LÊ a coluna — ela
 * espelha o orçado —, e sem esta guarda o espelho ressuscitaria o custo
 * que o banco zerou, jogando a rentabilidade do grupo para negativa.
 */
export function planejadoBrutoDoItem(
  tipo: TipoCusto,
  totalOrcado: number,
  totalPlanejado: number,
  emSave = false,
): number {
  if (emSave) return 0;
  return planejadoEspelhaOrcado(tipo)
    ? Number(totalOrcado ?? 0)
    : Number(totalPlanejado ?? 0);
}

/**
 * Realizado BRUTO do item — o custo cheio, antes do BV.
 *
 * Em `A` e `D` é o orçado, desde a abertura do job: o cliente já pagou o
 * fornecedor e não há PP para acompanhar. Nos demais é a soma das PPs não
 * canceladas do item, que começa em zero e sobe a cada PP emitida.
 */
export function realizadoBrutoDoItem(
  tipo: TipoCusto,
  totalOrcado: number,
  somaDasPPs: number,
  jobAberto = true,
  emSave = false,
): number {
  // Linha em save não tem custo — nem planejado nem realizado. Em `A` e
  // `D` o realizado é espelho do orçado, e sem esta guarda a linha que o
  // cliente vai gastar noutro job apareceria gasta aqui.
  if (emSave) return 0;
  // Job que o financeiro ainda não abriu não tem realizado nenhum — nem
  // o do orçado. A produção pode ter começado a gastar, mas o job ainda
  // pode voltar, e a linha `A` mostrando o orçado ali leria como "já
  // saiu". Nos tipos que geram PP isso já acontecia sozinho (não há PP
  // antes da abertura); em `A` e `D` precisa ser dito.
  if (!jobAberto) return 0;
  return realizadoVemDasPPs(tipo)
    ? Number(somaDasPPs ?? 0)
    : Number(totalOrcado ?? 0);
}

/** Aplica a vista a um valor bruto já calculado. */
export function aplicarVisao(
  bruto: number,
  deducaoBv: number,
  visao: VisaoBv,
): number {
  return visao === "liquido"
    ? arredondar(Number(bruto ?? 0) - Number(deducaoBv ?? 0))
    : Number(bruto ?? 0);
}

/** As duas leituras de um bloco da linha, prontas para a tela. */
export interface ValoresDoBloco {
  /** Custo cheio, sem tocar no BV. */
  bruto: number;
  /** Quanto de BV líquido este bloco deduz. Zero quando não há BV que
   *  conte para ele — e é o que a sub-linha "BV −x" mostra. */
  deducaoBv: number;
  /** `bruto − deducaoBv`. */
  liquido: number;
  /** Há BV lançado, mas ele ainda não conta para este bloco. Só acontece
   *  no REALIZADO, com BV `a_negociar`: a linha mostra "BV não emitido"
   *  em vez de uma dedução de zero, que pareceria "não tem BV". */
  bvPendente: boolean;
}

/** Monta os dois números de um bloco a partir do bruto e do BV da linha. */
export function valoresDoBloco(
  bruto: number,
  deducaoBv: number,
  bvPendente = false,
): ValoresDoBloco {
  const b = Number(bruto ?? 0);
  const d = Number(deducaoBv ?? 0);
  return {
    bruto: b,
    deducaoBv: d,
    liquido: arredondar(b - d),
    bvPendente,
  };
}

/** Escolhe o número do bloco conforme a vista ativa. */
export function valorNaVisao(bloco: ValoresDoBloco, visao: VisaoBv): number {
  return visao === "liquido" ? bloco.liquido : bloco.bruto;
}

/** Soma dois blocos — usado para fechar subtotal de grupo e total geral,
 *  que mostram a mesma sub-linha de BV que as linhas de item. */
export function somarBlocos(
  a: ValoresDoBloco,
  b: ValoresDoBloco,
): ValoresDoBloco {
  return {
    bruto: arredondar(a.bruto + b.bruto),
    deducaoBv: arredondar(a.deducaoBv + b.deducaoBv),
    liquido: arredondar(a.liquido + b.liquido),
    bvPendente: a.bvPendente || b.bvPendente,
  };
}

/** Bloco vazio — semente do `reduce` que fecha os subtotais. */
export const BLOCO_ZERO: ValoresDoBloco = {
  bruto: 0,
  deducaoBv: 0,
  liquido: 0,
  bvPendente: false,
};

/** O que a conta precisa saber de um item da planilha. `ItemPlanilhaJob`
 *  (job) e `VersaoOrcamentoItem` (orçamento) satisfazem os dois. */
export interface ItemParaBv {
  tipo_custo: TipoCusto;
  total_orcado: number | string | null;
  total_planejado: number | string | null;
  /** BV líquido congelado na aprovação. `null`/ausente ⇒ a versão ainda
   *  está aberta e a dedução é calculada a partir do BV vigente. */
  bv_liquido_planejado?: number | string | null;
  /** A linha gera SAVE: é faturada aqui e o serviço não acontece neste
   *  projeto. Fica fora da rentabilidade, porque não tem custo com que
   *  comparar (docs/decisions/023-save-entre-jobs.md §9). */
  em_save?: boolean | null;
}

/** O que a conta precisa saber do BV da linha. */
export interface BvParaConta {
  valor: number | string | null;
  situacao: BvSituacao;
}

/** Os três blocos de UMA linha, com a dedução de BV separada do bruto.
 *
 *  É a fonte única: planilha do job, card de Totais, visão agregada e
 *  planilha do orçamento passam por aqui. Duas implementações da mesma
 *  conta é como o número da linha e o número do subtotal começam a
 *  divergir.
 *
 *  A assimetria entre os dois blocos é deliberada:
 *
 *  - **Planejado** usa o BV CONGELADO (`bv_liquido_planejado`). Editar o
 *    BV depois da abertura não mexe nele — o planejado é o compromisso
 *    fechado no envio para abertura.
 *  - **Realizado** usa o BV vigente, e só a partir de `confirmado`. É lá
 *    que o valor novo se materializa.
 */
export function blocosDoItem(
  item: ItemParaBv,
  bv: BvParaConta | null,
  somaDasPPs: number,
  percentualImposto: number,
  /** O financeiro já abriu o job? Falso zera o REALIZADO inteiro — ver
   *  `realizadoBrutoDoItem`. Default `true` porque no orçamento não há
   *  job nenhum e o bloco não é exibido de todo jeito. */
  jobAberto = true,
): {
  orcado: number;
  /** O orçado que serve de BASE À RENTABILIDADE — zero na linha em save.
   *  Separado de `orcado` de propósito: a coluna ORÇADO continua mostrando
   *  o valor cheio (ele está sendo faturado), mas comparar esse valor com
   *  um custo que não existe daria 100% de margem em toda planilha com
   *  save (decisão 023 §9). */
  orcadoRentabilidade: number;
  planejado: ValoresDoBloco;
  realizado: ValoresDoBloco;
} {
  const orcado = Number(item.total_orcado ?? 0);

  const emSave = item.em_save === true;

  const planejadoBruto = planejadoBrutoDoItem(
    item.tipo_custo,
    orcado,
    Number(item.total_planejado ?? 0),
    emSave,
  );

  const congelado = item.bv_liquido_planejado;
  const deducaoPlanejado =
    bv && bvContaNoPlanejado(bv.situacao)
      ? congelado === null || congelado === undefined
        ? bvLiquido(Number(bv.valor ?? 0), percentualImposto)
        : Number(congelado)
      : 0;

  const realizadoBruto = realizadoBrutoDoItem(
    item.tipo_custo,
    orcado,
    somaDasPPs,
    jobAberto,
    emSave,
  );
  const bvConfirmado = bv !== null && bvContaNoRealizado(bv.situacao);
  const deducaoRealizado = bvConfirmado
    ? bvLiquido(Number(bv.valor ?? 0), percentualImposto)
    : 0;

  return {
    orcado,
    // A linha em save é venda sem execução: ela fica fora da comparação
    // orçado × custo, mas continua cheia na coluna ORÇADO.
    orcadoRentabilidade: emSave ? 0 : orcado,
    planejado: valoresDoBloco(planejadoBruto, deducaoPlanejado),
    realizado: valoresDoBloco(
      realizadoBruto,
      deducaoRealizado,
      // "BV não emitido" só faz sentido quando há bruto de onde deduzir:
      // numa linha ainda sem PP o aviso seria ruído.
      bv !== null && !bvConfirmado && realizadoBruto > 0,
    ),
  };
}

/** Fecha os três blocos de uma lista de itens — subtotal de grupo, card
 *  de Totais e visão agregada saem daqui. */
export function somarBlocosDosItens(
  blocos: Array<{
    orcado: number;
    orcadoRentabilidade?: number;
    planejado: ValoresDoBloco;
    realizado: ValoresDoBloco;
  }>,
): {
  orcado: number;
  orcadoRentabilidade: number;
  planejado: ValoresDoBloco;
  realizado: ValoresDoBloco;
} {
  let orcado = 0;
  let orcadoRentabilidade = 0;
  let planejado = BLOCO_ZERO;
  let realizado = BLOCO_ZERO;
  for (const b of blocos) {
    orcado += b.orcado;
    orcadoRentabilidade += b.orcadoRentabilidade ?? b.orcado;
    planejado = somarBlocos(planejado, b.planejado);
    realizado = somarBlocos(realizado, b.realizado);
  }
  return {
    orcado: arredondar(orcado),
    orcadoRentabilidade: arredondar(orcadoRentabilidade),
    planejado,
    realizado,
  };
}

/** Rótulo da coluna Total conforme a vista. Do design 3b. */
export function rotuloColunaTotal(visao: VisaoBv): string {
  return visao === "liquido" ? "Total líquido" : "Total";
}

/** Rótulo da linha de subtotal do grupo conforme a vista. Do design 3b. */
export function rotuloSubtotal(visao: VisaoBv): string {
  return visao === "liquido"
    ? "Subtotal do grupo · líquido (− BV)"
    : "Subtotal do grupo";
}
