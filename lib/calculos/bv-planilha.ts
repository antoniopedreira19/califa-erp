/**
 * O BV dentro da planilha — imposto, valor líquido e as duas vistas.
 *
 * Até 21/08/2026 o BV era um registro paralelo: existia em `itens_bv`,
 * aparecia no formulário e não mexia em número nenhum da planilha. Agora
 * ele participa da conta, e participa em DUAS leituras da mesma tela:
 *
 * - **Bruto** — o custo cheio, como sempre foi.
 * - **Líquido (− BV)** — o custo sem a comissão que volta para a
 *   California. É o número que o financeiro persegue, e é o padrão
 *   desde 27/08/2026.
 *
 * A chave que alterna as duas mexe **só no REALIZADO** desde 08/09/2026
 * (decisão 062): o ORÇADO nunca recebeu BV, e o PLANEJADO deixou de
 * receber. Por isso ela só existe nas telas do job — no orçamento não
 * havia mais o que ela mudar.
 *
 * O que se subtrai é o **BV bruto**, o valor cheio negociado com o
 * fornecedor. Até 08/09/2026 era o líquido (valor menos a alíquota do
 * job); a alíquota virou campo do próprio BV e passou a servir só ao que
 * o financeiro emite, não à planilha (decisão 062).
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

/**
 * Como a planilha ABRE, em toda tela que usa a chave.
 *
 * Era "bruto" até 27/08/2026. O design "Enviar Job - Ajustes de Campos"
 * inverteu: quem abre a tela quer o número que o financeiro persegue, e
 * o bruto passa a ser a escolha explícita do usuário. A chave continua
 * valendo para grupos, itens e totais ao mesmo tempo, e continua sem ser
 * memorizada entre sessões.
 */
export const VISAO_BV_PADRAO: VisaoBv = "liquido";

/**
 * Imposto sobre o BV: multiplicação direta pela alíquota do job.
 *
 * NÃO é o gross-up do fechamento da versão (`base × t / (1 − t)`). Lá a
 * agência precisa faturar bruto o bastante para sobrar a base líquida;
 * aqui o valor do BV já é o bruto negociado com o fornecedor, e o imposto
 * é uma fatia dele. Do design "Job - A com Repasse - BV e PP", tela 4a:
 * R$ 10.000,00 a 19,54% dá R$ 1.954,00, e não R$ 2.428,52.
 *
 * A alíquota é a **do próprio BV** (`itens_bv.percentual_imposto`) desde
 * 08/09/2026. Antes ela vinha do job; agora é digitada no formulário,
 * pode ficar vazia enquanto se negocia e é exigida para confirmar
 * (decisão 062).
 *
 * ⚠️ Isto NÃO alimenta mais a planilha. O REALIZADO desconta o bruto. O
 * líquido continua sendo o que de fato sobra para a California, e é o
 * que o formulário mostra e o financeiro usa.
 */
export function impostoDoBv(
  valorBv: number,
  percentualImposto: number,
): number {
  const taxa = Math.max(0, Math.min(1, Number(percentualImposto ?? 0) / 100));
  return arredondar(Number(valorBv ?? 0) * taxa);
}

/** O que de fato volta para a California, já descontado o imposto.
 *  Informativo desde 08/09/2026: a planilha subtrai o BRUTO. */
export function bvLiquido(valorBv: number, percentualImposto: number): number {
  return arredondar(
    Number(valorBv ?? 0) - impostoDoBv(valorBv, percentualImposto),
  );
}

/**
 * O PLANEJADO não recebe BV (decisão 062, 08/09/2026).
 *
 * Até aqui ele descontava todos os BVs ativos, por um valor congelado na
 * aprovação da versão (`bv_liquido_planejado`). O planejado passou a ser
 * o custo que o GP registra, e só isso; a comissão aparece quando ela
 * acontece, que é no REALIZADO.
 *
 * A função ficou como constante para que a intenção seja legível na
 * conta — e não um zero solto que o próximo leitor tome por bug.
 */
const DEDUCAO_BV_NO_PLANEJADO = 0;

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
 * Quanto os BVs de UMA linha descontam do realizado dela.
 *
 * Soma o **bruto** dos que já contam. Um item pode ter vários BVs desde
 * 08/09/2026 (decisão 062), cada um com situação própria — então isto é
 * uma soma filtrada, e não mais a leitura de um registro só.
 */
export function deducaoBvDoRealizado(bvs: readonly BvParaConta[]): number {
  return arredondar(
    bvs.reduce(
      (s, bv) =>
        bvContaNoRealizado(bv.situacao) ? s + Number(bv.valor ?? 0) : s,
      0,
    ),
  );
}

/** Há BV lançado na linha que ainda NÃO conta para o realizado — o que
 *  produz o rótulo "BV não emitido" em vez de uma dedução de zero. */
export function temBvPendente(bvs: readonly BvParaConta[]): boolean {
  return bvs.some((bv) => !bvContaNoRealizado(bv.situacao) && bv.situacao !== "cancelado");
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
 * Planejado do item — o custo que o GP registrou.
 *
 * É a coluna PLANEJADO, em TODOS os tipos. Até 08/09/2026 `A` e `D`
 * ignoravam a coluna e espelhavam o orçado; a decisão 062 acabou com o
 * espelho, e com ele acabou a única razão de esta função consultar o
 * tipo de custo.
 *
 * `emSave` continua vindo antes: a linha em save é venda sem execução, e
 * não tem custo nenhum neste job (decisão 028 §9). O trigger já grava
 * zero nas três células, e a guarda aqui é o cinto — uma leitura que
 * chegue com valor velho em cache não ressuscita o custo.
 *
 * Não há mais dedução de BV neste bloco: o BV desconta o REALIZADO.
 */
export function planejadoBrutoDoItem(
  totalPlanejado: number,
  emSave = false,
): number {
  if (emSave) return 0;
  return Number(totalPlanejado ?? 0);
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
 *  (job) e `VersaoOrcamentoItem` (orçamento) satisfazem os dois.
 *
 *  `bv_liquido_planejado` saiu daqui em 08/09/2026: com o BV fora do
 *  planejado, o congelamento da aprovação não tem mais o que congelar. A
 *  COLUNA continua no banco, guardando o que já foi congelado — é
 *  histórico, não entrada de conta. */
export interface ItemParaBv {
  tipo_custo: TipoCusto;
  total_orcado: number | string | null;
  total_planejado: number | string | null;
  /** A linha gera SAVE: é faturada aqui e o serviço não acontece neste
   *  projeto. Fica fora da rentabilidade, porque não tem custo com que
   *  comparar (docs/decisions/028-save-entre-jobs.md §9). */
  em_save?: boolean | null;
}

/** O que a conta precisa saber de UM BV da linha. */
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
 *  **Só o REALIZADO desconta BV** (decisão 062, 08/09/2026), e desconta a
 *  SOMA do bruto de todos os BVs do item que já contam — `confirmado` e
 *  `recebido`. O PLANEJADO mostra sempre o custo cheio que o GP
 *  registrou; a comissão entra na conta quando ela acontece.
 *
 *  Isso desfez a assimetria que existia entre os dois blocos, e com ela o
 *  congelamento do BV na aprovação: não há mais nada a congelar.
 */
export function blocosDoItem(
  item: ItemParaBv,
  /** TODOS os BVs da linha. Lista vazia = linha sem BV. */
  bvs: readonly BvParaConta[],
  somaDasPPs: number,
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
   *  save (decisão 028 §9). */
  orcadoRentabilidade: number;
  planejado: ValoresDoBloco;
  realizado: ValoresDoBloco;
} {
  const orcado = Number(item.total_orcado ?? 0);

  const emSave = item.em_save === true;

  const planejadoBruto = planejadoBrutoDoItem(
    Number(item.total_planejado ?? 0),
    emSave,
  );

  const realizadoBruto = realizadoBrutoDoItem(
    item.tipo_custo,
    orcado,
    somaDasPPs,
    jobAberto,
    emSave,
  );
  const deducaoRealizado = deducaoBvDoRealizado(bvs);

  return {
    orcado,
    // A linha em save é venda sem execução: ela fica fora da comparação
    // orçado × custo, mas continua cheia na coluna ORÇADO.
    orcadoRentabilidade: emSave ? 0 : orcado,
    planejado: valoresDoBloco(planejadoBruto, DEDUCAO_BV_NO_PLANEJADO),
    realizado: valoresDoBloco(
      realizadoBruto,
      deducaoRealizado,
      // "BV não emitido" só faz sentido quando há bruto de onde deduzir:
      // numa linha ainda sem PP o aviso seria ruído.
      temBvPendente(bvs) && realizadoBruto > 0,
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
