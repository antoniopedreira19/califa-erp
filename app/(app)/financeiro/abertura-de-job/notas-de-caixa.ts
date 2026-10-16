import type { JobAberto } from "./dados-abertos";

/**
 * A segunda linha das células de Recebimentos e Custos: o que o número de
 * cima ainda não conta sozinho.
 *
 * A ordem importa. Havendo realizado, é ele que qualifica o total —
 * "62% recebido" diz mais do que qualquer rótulo. Sem realizado, o que
 * interessa é a procedência: número vindo do fluxo de caixa (previsão ou
 * documento) contra número que caiu no previsto da abertura, porque o
 * job ainda não tem NADA lançado daquele lado.
 *
 * Módulo próprio desde 16/10/2026: a lista e a exportação em Excel da
 * aba Visualizar Jobs escrevem a MESMA nota.
 */
function notaDeCaixa(
  total: number,
  realizado: number,
  doPrevisto: boolean,
  rotuloRealizado: string,
  rotuloZerado: string,
): string {
  if (total <= 0) return "sem previsão";
  if (realizado > 0) {
    const pct = ((realizado / total) * 100).toLocaleString("pt-BR", {
      maximumFractionDigits: 0,
    });
    return `${pct}% ${rotuloRealizado}`;
  }
  if (doPrevisto) return "previsto na abertura";
  return rotuloZerado;
}

export const notaRecebimento = (j: JobAberto) =>
  notaDeCaixa(
    j.recebimentos,
    j.recebimentos_realizado,
    j.recebimentos_do_previsto,
    "recebido",
    "nada recebido",
  );

export const notaCusto = (j: JobAberto) =>
  notaDeCaixa(
    j.custos,
    j.custos_realizado,
    j.custos_do_previsto,
    "realizado",
    "sem realizado",
  );
