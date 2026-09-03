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
 * agora é uma regra de ENVIO: quando a soma das PPs que já chegaram ao
 * financeiro, mais a que está sendo enviada, passa do PLANEJADO do item,
 * o envio pede o responsável do job (ou administrador) e uma confirmação
 * explícita. `passaDoPlanejado` é essa comparação, com a mesma folga de
 * meio centavo que o teto tinha.
 *
 * A referência do item também mudou: era o orçado, é o planejado. É o
 * número que a produção de fato pretende gastar, e é contra ele que
 * "Em PPs emitidas" acende em vermelho.
 *
 * Este arquivo continua sendo a fonte única das contas — a tela usa para
 * mostrar e a server action usa para decidir. Duas implementações é como
 * o número da tela e o do servidor começam a divergir.
 *
 * ⚠️ O VALOR da PP deixou de ser rateio do orçado em 01/09/2026: agora é
 * `valorDaPPPorUnidade` (R$ Unit. × QT × D/M), no fim do arquivo.
 */

/** Centavo é a menor unidade: toda conta arredonda para 2 casas. */
function arredondar(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface PPParaSoma {
  valor: number;
  status: string;
}

/** A PP já chegou ao financeiro? Gerada e cancelada ficam de fora.
 *  Espelho de `ppChegouAoFinanceiro` em `lib/types.ts`, aceitando string
 *  porque as linhas chegam cruas do banco em vários lugares. */
function chegouAoFinanceiro(status: string): boolean {
  return status !== "gerada" && status !== "cancelada";
}

/**
 * O que já está comprometido em PPs — o "Em PPs emitidas" do painel e do
 * formulário.
 *
 * Só as PPs que CHEGARAM ao financeiro (decisão do Tiago, 02/09/2026):
 * a gerada ainda pode ser editada ou cancelada sem ninguém saber, e
 * somá-la aqui faria o item parecer mais gasto do que está. A rejeitada
 * entra: ela vai ser corrigida e reenviada, então o dinheiro segue
 * comprometido — quem tira uma PP do item é só o cancelamento.
 */
export function somaDasPPsEmitidas(pps: PPParaSoma[]): number {
  return arredondar(
    pps
      .filter((pp) => chegouAoFinanceiro(pp.status))
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
