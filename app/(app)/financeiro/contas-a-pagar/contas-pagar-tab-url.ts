/**
 * A aba de Contas a Pagar como ela viaja na URL (`?tab=`). Módulo PURO,
 * sem "use client": a página (server component) lê a aba pedida por aqui,
 * e um módulo cliente não pode exportar função para o servidor chamar —
 * ela chega lá como referência, e `lerTab(...)` quebra em tempo de
 * execução com "is not a function" (20/09/2026).
 */
export type TabKey =
  | "pps"
  | "desembolsos"
  | "titulos"
  | "cartao"
  | "recorrentes"
  | "folhas";

const TABS: TabKey[] = ["pps", "desembolsos", "titulos", "cartao", "recorrentes", "folhas"];

/** `?tab=` da URL vira aba; qualquer outra coisa vira `undefined`. */
export function lerTab(valor: string | undefined): TabKey | undefined {
  return TABS.includes(valor as TabKey) ? (valor as TabKey) : undefined;
}
