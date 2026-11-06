/**
 * A troca do job para dentro ou para fora do serviço Interno pelo "Editar
 * registro" (decisão 240, revê a 105 §3-a).
 *
 * Entrar: toda linha vira F · Interno (FI) e o planejado passa a ser o
 * orçado. Sair: o FI vira B, e o planejado fica como está. Quem grava é a
 * RPC `trocar_job_de_lado_do_interno`; aqui mora só a conta, para a
 * prévia do formulário e a conferência da action usarem a mesma.
 */
import type { TipoCusto } from "@/lib/types";

export type SentidoDaTroca = "entra" | "sai";

/** O sentido da troca, ou `null` quando o serviço novo fica do mesmo lado
 *  do Interno que o orçamento do job. */
export function sentidoDaTroca(
  orcamentoEhInterno: boolean,
  servicoNovoEhInterno: boolean,
): SentidoDaTroca | null {
  if (orcamentoEhInterno === servicoNovoEhInterno) return null;
  return servicoNovoEhInterno ? "entra" : "sai";
}

/** O tipo de custo de uma linha depois da troca. */
export function tipoDepoisDaTroca(tipo: TipoCusto, sentido: SentidoDaTroca): TipoCusto {
  if (sentido === "entra") return "FI";
  return tipo === "FI" ? "B" : tipo;
}

/** As linhas com o tipo de depois da troca. */
export function linhasDepoisDaTroca<T extends { tipo_custo: TipoCusto }>(
  linhas: readonly T[],
  sentido: SentidoDaTroca,
): T[] {
  return linhas.map((l) => ({ ...l, tipo_custo: tipoDepoisDaTroca(l.tipo_custo, sentido) }));
}

/** O planejado de uma linha depois da troca: na entrada, o orçado. */
export function planejadoDepoisDaTroca(
  linha: { total_orcado: number; total_planejado: number },
  sentido: SentidoDaTroca,
): number {
  return sentido === "entra" ? linha.total_orcado : linha.total_planejado;
}

const ORDEM_DOS_TIPOS: TipoCusto[] = ["A", "AR", "B", "C", "D", "F", "FI"];

/** Os tipos de custo das linhas, sem repetir, na ordem da planilha. */
export function tiposDasLinhas(linhas: readonly { tipo_custo: TipoCusto }[]): TipoCusto[] {
  return ORDEM_DOS_TIPOS.filter((t) => linhas.some((l) => l.tipo_custo === t));
}

/** "B", "A, B e D" — as siglas, como o pop-up mostra (Tiago, 05/11/2026). */
export function rotuloDosTipos(tipos: readonly TipoCusto[]): string {
  if (tipos.length <= 1) return tipos[0] ?? "—";
  return `${tipos.slice(0, -1).join(", ")} e ${tipos[tipos.length - 1]}`;
}
