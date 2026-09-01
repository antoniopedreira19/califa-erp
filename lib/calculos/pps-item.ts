/**
 * Contas das PPs parciais de um item da planilha do job.
 *
 * Desde 17/08/2026 um item pode ter MAIS DE UMA PP — sem limite de
 * quantas, e sem limite por fornecedor. O que trava é o saldo: a soma das
 * PPs não canceladas nunca passa do ORÇADO do item. É a regra do design
 * "Job - PPs Parciais - Opcoes" (opção 2a) e ela mora no banco também, no
 * trigger `pp_valida_saldo_do_item`.
 *
 * ⚠️ A base era o REALIZADO até 21/08/2026. Trocou porque o realizado
 * passou a ser a própria soma das PPs (trigger
 * `trg_pp_recalcula_realizado`): comparar a soma consigo mesma nunca
 * barraria nada, e a primeira PP de um item nunca caberia. Ver
 * `docs/decisions/022-bv-liquido-e-realizado-por-pp.md`.
 *
 * Este arquivo é a fonte única das contas — a tela usa para mostrar o
 * saldo e o "máximo aceito", e a server action usa para recusar. Duas
 * implementações da mesma conta é como o número da tela e o do servidor
 * começam a divergir.
 *
 * ⚠️ O VALOR da PP deixou de ser rateio do orçado em 01/09/2026: agora é
 * `valorDaPPPorUnidade` (R$ Unit. × QT × D/M), no fim do arquivo. As
 * funções `unitarioEfetivo`/`valorDaPP` que faziam o rateio foram
 * removidas junto — deixá-las por perto era convite a reintroduzir a
 * conta antiga em algum caminho novo.
 */

/** Centavo é a menor unidade: toda conta arredonda para 2 casas. */
function arredondar(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface PPParaSaldo {
  valor: number;
  status: string;
}

/**
 * Quanto do item ainda pode virar PP.
 *
 * Só o CANCELAMENTO devolve saldo (decisão do Tiago, 17/08/2026). PP
 * rejeitada pelo financeiro continua ocupando: ela vai ser corrigida e
 * reenviada pelo GP, então o dinheiro segue reservado — se ela liberasse
 * o saldo, outra PP poderia consumi-lo e o reenvio ficaria impossível.
 */
export function saldoDoItem(
  totalOrcado: number,
  pps: PPParaSaldo[],
): number {
  return arredondar(totalOrcado - somaDasPPs(pps));
}

/** O que já está comprometido em PPs — o "Em PPs emitidas" do painel. */
export function somaDasPPs(pps: PPParaSaldo[]): number {
  return arredondar(
    pps
      .filter((pp) => pp.status !== "cancelada")
      .reduce((s, pp) => s + Number(pp.valor ?? 0), 0),
  );
}

/**
 * Meio centavo de folga na comparação com o saldo.
 *
 * O valor da PP é quantidade × unitário efetivo, arredondado a 2 casas.
 * Quando o unitário tem dízima (R$ 11,7533…), a última fatia do item pode
 * fechar um centavo acima do saldo por arredondamento, e recusar isso
 * deixaria o item impossível de fechar. Mesma tolerância do trigger.
 */
export const TOLERANCIA_SALDO = 0.005;

export function passaDoSaldo(valor: number, saldo: number): boolean {
  return valor - saldo > TOLERANCIA_SALDO;
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
 * unitário da PP pode ser diferente do orçado — é o desconto que o
 * fornecedor deu. O que continua limitando é o saldo em R$ do item
 * (`passaDoSaldo`), nunca a quantidade: 4 diárias a R$ 2.500 cabem num
 * item orçado como 2 diárias a R$ 5.000.
 */
export function valorDaPPPorUnidade(
  unitario: number,
  quantidade: number,
  diasMeses: number,
): number {
  if (unitario <= 0 || quantidade <= 0 || diasMeses <= 0) return 0;
  return arredondar(unitario * quantidade * diasMeses);
}
