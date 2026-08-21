import type { SituacaoFaturamento } from "@/lib/calculos/esteira-faturamento";

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
  liquidado: {
    rotulo: "Liquidado",
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
  enviado: {
    rotulo: "Enviado",
    classes: "border-amber-200 bg-amber-50 text-amber-700",
  },
  aguardando_envio: {
    rotulo: "Aguardando envio",
    classes: "border-border bg-muted/80 text-muted-foreground",
  },
};
