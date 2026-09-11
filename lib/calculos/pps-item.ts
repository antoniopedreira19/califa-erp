/**
 * Contas das PPs parciais de um item da planilha do job.
 *
 * Desde 17/08/2026 um item pode ter MAIS DE UMA PP — sem limite de
 * quantas, e sem limite por fornecedor.
 *
 * ⚠️ O TETO por PP saiu em 02/09/2026 (decisão 039). Até ali a soma das
 * PPs não canceladas não podia passar do ORÇADO do item — aqui em
 * `saldoDoItem`/`passaDoSaldo` e no banco, no trigger
 * `pp_valida_saldo_do_item`. As duas coisas foram removidas. O que existe
 * agora é uma regra de ENVIO: quando a soma das PPs do item passa do
 * PLANEJADO dele, o envio pede o responsável do job (ou administrador) e
 * uma confirmação explícita. `passaDoPlanejado` é essa comparação, com a mesma folga de
 * meio centavo que o teto tinha.
 *
 * A referência do item também mudou: era o orçado, é o planejado. É o
 * número que a produção de fato pretende gastar, e é contra ele que
 * "Em PPs emitidas" acende em vermelho.
 *
 * ⚠️ O RECORTE da soma mudou em 11/09/2026 (decisão 074). De 02/09 até
 * ali, "Em PPs emitidas" e o realizado do item contavam só as PPs que
 * tinham CHEGADO ao financeiro, e a `gerada` ficava de fora. O efeito na
 * tela era um job inteiro de PPs geradas aparecendo como se nada tivesse
 * sido feito — realizado zerado em toda linha e "sem realizado" no card
 * do topo. Agora toda PP que existe no item pesa, e só o cancelamento
 * tira. `somaDasPPsNaoCanceladas` passou a ser a conta única.
 *
 * Este arquivo continua sendo a fonte única das contas — a tela usa para
 * mostrar e a server action usa para decidir. Duas implementações é como
 * o número da tela e o do servidor começam a divergir.
 *
 * ⚠️ O VALOR da PP deixou de ser rateio do orçado em 01/09/2026: agora é
 * `valorDaPPPorUnidade` (R$ Unit. × QT × D/M), no fim do arquivo.
 */

import type { TipoCusto } from "@/lib/types";
import { TIPOS_CUSTO, tipoGeraDesembolso } from "./versao-totais";

/**
 * A linha precisa dizer se ainda sai PP dela? (decisão 052)
 *
 * Fonte única do recorte, e por isso mora AQUI, num módulo puro: a barra
 * da planilha é client component, a trava do encerramento é server
 * action e a página do job calcula em memória. Os três leem daqui.
 *
 *   * `A · Direto` e `D · Interno` pagam por BV, não têm calha de PP e
 *     não entram na previsão de custo;
 *   * linha em SAVE não emite PP neste job (decisão 028 §9) — a calha
 *     dela nem oferece o botão, então travaria o encerramento para
 *     sempre.
 */
export function itemPrecisaDeConclusao(
  tipoCusto: TipoCusto,
  emSave: boolean,
): boolean {
  return tipoGeraDesembolso(tipoCusto) && !emSave;
}

/** Os tipos de custo que geram PP — a lista sai da matriz de tipos, não
 *  de um array escrito à mão: tipo novo entra aqui sozinho. */
export const TIPOS_QUE_GERAM_PP = TIPOS_CUSTO.filter(tipoGeraDesembolso);

/** Centavo é a menor unidade: toda conta arredonda para 2 casas. */
function arredondar(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface PPParaSoma {
  valor: number;
  status: string;
}

/**
 * O que o item tem comprometido em PPs — **todas menos as canceladas**.
 *
 * Conta única do sistema desde 11/09/2026 (decisão 074): é o
 * "Em PPs emitidas" do painel e do formulário, é a base do realizado do
 * item no banco (`recalcular_realizado_do_item`), é a base da
 * confirmação de envio acima do planejado e é a trava do `AR`, no fim do
 * arquivo. Antes eram duas contas, e a do painel não via a `gerada`.
 *
 * Por que a `gerada` conta: ela é dinheiro que o GP já comprometeu com o
 * fornecedor: o item está gasto, ainda que o financeiro não tenha visto.
 * O que ela NÃO faz é congelar previsão no financeiro nem travar errata —
 * esses dois seguem no recorte `ppChegouAoFinanceiro` de `lib/types.ts`.
 *
 * A `rejeitada` conta pela regra de sempre: vai ser corrigida e
 * reenviada. Quem tira uma PP do item é só o cancelamento.
 */
export function somaDasPPsNaoCanceladas(pps: PPParaSoma[]): number {
  return arredondar(
    pps
      .filter((pp) => pp.status !== "cancelada")
      .reduce((s, pp) => s + Number(pp.valor ?? 0), 0),
  );
}

/** Quantas PPs do item ainda não foram enviadas — o contador do chip. */
export function contarPendentes(pps: Array<{ status: string }>): number {
  return pps.filter((pp) => pp.status === "gerada").length;
}

/**
 * Meio centavo de folga na comparação com o planejado.
 *
 * O valor da PP é R$ Unit. × QT × D/M, arredondado a 2 casas. Quando o
 * unitário tem dízima, a última fatia do item pode fechar um centavo
 * acima do planejado por arredondamento — e pedir confirmação do GP por
 * um centavo seria ruído, não regra.
 */
export const TOLERANCIA_PLANEJADO = 0.005;

/**
 * A soma passa do planejado do item?
 *
 * Não barra nada: quem passa daqui é o envio, que pede o responsável do
 * job e uma confirmação. Linha vermelha tem planejado zero, então toda PP
 * dela passa — é a regra literal, decidida em 02/09/2026: custo que o
 * orçamento não previu passa pelo GP.
 */
export function passaDoPlanejado(soma: number, planejado: number): boolean {
  return soma - planejado > TOLERANCIA_PLANEJADO;
}

// ---------------------------------------------------------------------
// A · Repasse: a soma das PPs precisa fechar o orçado
// ---------------------------------------------------------------------

/**
 * O item exige que as PPs FECHEM o orçado antes de sair do lugar?
 *
 * Só o `AR` (decisão 062, 08/09/2026). Nele o principal passa pela
 * California e é REPASSADO ao fornecedor — não é margem, é dinheiro de
 * passagem. Fechar o item deixando saldo sem repassar significaria a
 * agência ficando com o que era do fornecedor.
 *
 * Nos demais tipos de calha PP (`B`, `C`, `F`, `FI`) o orçado é preço, e
 * gastar menos que ele é lucro legítimo: eles seguem como a decisão 039
 * deixou, sem teto e sem piso.
 *
 * Linha em SAVE fica de fora: ela não emite PP neste job (decisão 028
 * §9), então travaria para sempre.
 */
export function exigeSomaIgualAoOrcado(
  tipoCusto: TipoCusto,
  emSave: boolean,
): boolean {
  return tipoCusto === "AR" && !emSave;
}

/**
 * Quanto falta o item `AR` gerar em PPs para fechar o orçado. Zero (ou
 * negativo) = pode enviar e pode concluir.
 *
 * ⚠️ É "não pode ser MENOR que o orçado", e não igualdade estrita.
 * Passar do orçado já tem tratamento próprio desde a decisão 039 — o
 * envio acima do planejado pede confirmação do responsável do job —, e
 * exigir igualdade exata criaria um beco: a errata pode baixar o orçado
 * depois, e não existe "des-enviar PP". A trava existe para impedir o
 * caso real, que é fechar deixando saldo por repassar.
 *
 * A mesma folga de meio centavo do planejado, e pelo mesmo motivo: o
 * valor da PP é R$ Unit. × QT × D/M arredondado, e unitário com dízima
 * fecha um centavo fora.
 */
export function faltaParaFecharOOrcado(
  somaDasPPs: number,
  orcado: number,
): number {
  const falta = arredondar(orcado - somaDasPPs);
  return falta > TOLERANCIA_PLANEJADO ? falta : 0;
}

/**
 * Divisão do valor da PP entre N parcelas.
 *
 * Parte igual para todas e a SOBRA vai para a última: dividir R$ 100,00
 * em 3 dá 33,33 + 33,33 + 33,34. A soma tem que fechar exatamente com o
 * valor da PP — é isso que o formulário e a action validam.
 */
export function dividirEmParcelas(valor: number, quantidade: number): number[] {
  if (quantidade < 1) return [];
  const base = Math.floor((valor * 100) / quantidade) / 100;
  const parcelas = Array.from({ length: quantidade }, () => base);
  const soma = arredondar(base * quantidade);
  parcelas[quantidade - 1] = arredondar(
    parcelas[quantidade - 1] + (valor - soma),
  );
  return parcelas;
}

/** A soma das parcelas fecha com o valor da PP? (tolerância de 1 centavo) */
export function parcelasFecham(parcelas: number[], valor: number): boolean {
  const soma = arredondar(parcelas.reduce((s, v) => s + v, 0));
  return Math.abs(soma - valor) < 0.005;
}

/**
 * Vencimento sugerido da parcela seguinte: mesmo dia do mês seguinte.
 *
 * Dia 31 em mês de 30 cai para o último dia do mês (31/01 → 28/02), que é
 * o comportamento que o fornecedor espera de "vence todo dia 31".
 * Trabalha em string YYYY-MM-DD para não passar por fuso.
 */
export function proximoVencimento(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) return iso;
  const proximoMes = mes === 12 ? 1 : mes + 1;
  const proximoAno = mes === 12 ? ano + 1 : ano;
  const ultimoDia = new Date(Date.UTC(proximoAno, proximoMes, 0)).getUTCDate();
  const diaFinal = Math.min(dia, ultimoDia);
  return `${proximoAno}-${String(proximoMes).padStart(2, "0")}-${String(diaFinal).padStart(2, "0")}`;
}

/**
 * Valor de uma PP montada como a linha da planilha: R$ Unit. × QT × D/M.
 *
 * Substitui o rateio pelo orçado que valia até 01/09/2026. Ali o valor
 * saía de `quantidade × (total do item / quantidade do item)`, o que
 * embutia o D/M dentro do "unitário" e fazia o formulário chamar de
 * unitário um número que era o total: o item de R$ 5.000 × 1 × 2
 * aparecia como "R$ 10.000,00 por unidade do orçado".
 *
 * Agora os três fatores são do GP e nenhum deles é derivado do orçado. O
 * unitário da PP pode ser diferente do planejado — é o desconto que o
 * fornecedor deu. A quantidade nunca limita: 4 diárias a R$ 2.500 cabem
 * num item planejado como 2 diárias a R$ 5.000. E desde 02/09/2026 o
 * dinheiro também não barra — passar do planejado só muda quem pode
 * enviar (`passaDoPlanejado`).
 */
export function valorDaPPPorUnidade(
  unitario: number,
  quantidade: number,
  diasMeses: number,
): number {
  if (unitario <= 0 || quantidade <= 0 || diasMeses <= 0) return 0;
  return arredondar(unitario * quantidade * diasMeses);
}
