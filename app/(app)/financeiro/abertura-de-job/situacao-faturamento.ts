import type { SituacaoFaturamento } from "@/lib/calculos/esteira-faturamento";
import { formatCurrency } from "@/lib/utils";

/**
 * Rótulo e cor de cada situação da esteira de faturamento.
 *
 * Módulo neutro (sem `"use client"`) de propósito: o chip da lista de
 * jobs abertos é client component e o badge do cabeçalho do job é server
 * component, e os dois precisam do MESMO rótulo e da MESMA cor. Export
 * de módulo `"use client"` vira proxy no servidor — dar `.classes` nele
 * quebra em runtime, não na compilação.
 */
export const SITUACAO_META: Record<
  SituacaoFaturamento,
  { rotulo: string; classes: string }
> = {
  // Decisão 268: era "Liquidado".
  recebido: {
    rotulo: "Recebido",
    classes: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  // Inadimplente é o único estado que exige ação hoje — usa o vermelho da
  // casa, o mesmo dos alertas do resto do sistema.
  inadimplente: {
    rotulo: "Inadimplente",
    classes: "border-california-red/25 bg-california-red/5 text-california-red",
  },
  faturado: {
    rotulo: "Faturado",
    classes: "border-blue-200 bg-blue-50 text-blue-700",
  },
  // Decisão 268: faturado em parte — a nota saiu, mas falta faturar.
  parcial: {
    rotulo: "Parcial",
    classes: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  enviado: {
    rotulo: "Enviado",
    classes: "border-amber-200 bg-amber-50 text-amber-700",
  },
  aguardando_envio: {
    rotulo: "Aguardando envio",
    classes: "border-border bg-muted/80 text-muted-foreground",
  },
  // Nada a faturar (decisão 105): não é pendência, é ausência. Contorno
  // neutro sem fundo, para não se confundir com o "Aguardando envio".
  sem_faturamento: {
    rotulo: "Sem faturamento",
    classes: "border-border bg-transparent text-muted-foreground",
  },
};

/**
 * Decisão 268: a dica do selo "Parcial" — "Faturado parcialmente: R$ X de
 * R$ Y · falta R$ Z". Nula fora do parcial ou sem os dois valores.
 */
export function dicaDaSituacao(f: {
  situacao: SituacaoFaturamento;
  valor: number | null;
  valor_previsto: number | null;
}): string | null {
  if (f.situacao !== "parcial" || f.valor === null || f.valor_previsto === null) return null;
  const falta = Math.max(0, Math.round((f.valor_previsto - f.valor) * 100) / 100);
  return `Faturado parcialmente: ${formatCurrency(f.valor)} de ${formatCurrency(f.valor_previsto)} · falta ${formatCurrency(falta)}`;
}
