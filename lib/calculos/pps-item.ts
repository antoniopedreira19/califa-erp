/**
 * Contas das PPs parciais de um item da planilha do job.
 *
 * Desde 17/08/2026 um item pode ter MAIS DE UMA PP — sem limite de
 * quantas, e sem limite por fornecedor. O que trava é o saldo: a soma das
 * PPs não canceladas nunca passa do Realizado do item. É a regra do
 * design "Job - PPs Parciais - Opcoes" (opção 2a) e ela mora no banco
 * também, no trigger `pp_valida_saldo_do_item`.
 *
 * Este arquivo é a fonte única das contas — a tela usa para mostrar o
 * saldo e o "máximo aceito", e a server action usa para recusar. Duas
 * implementações da mesma conta é como o número da tela e o do servidor
 * começam a divergir.
 */

/** Centavo é a menor unidade: toda conta arredonda para 2 casas. */
function arredondar(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * R$ por unidade do REALIZADO — é o preço que a PP parcial usa.
 *
 * Sai de `total / quantidade`, e não de `valor_unitario_realizado`, de
 * propósito: o total do item é unitário × QT × D/M, então um item com
 * D/M = 2 custa o dobro por unidade entregue. Dividir o total pela
 * quantidade embute o D/M sozinho e vale para os dois casos.
 */
export function unitarioEfetivo(
  totalRealizado: number,
  quantidadeRealizada: number,
): number {
  if (quantidadeRealizada <= 0) return 0;
  return totalRealizado / quantidadeRealizada;
}

/** Valor de uma PP que leva `quantidade` unidades do item. */
export function valorDaPP(
  quantidade: number,
  totalRealizado: number,
  quantidadeRealizada: number,
): number {
  return arredondar(
    quantidade * unitarioEfetivo(totalRealizado, quantidadeRealizada),
  );
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
  totalRealizado: number,
  pps: PPParaSaldo[],
): number {
  return arredondar(totalRealizado - somaDasPPs(pps));
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
