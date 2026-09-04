import type { LucideIcon } from "lucide-react";

/** Card de pendencia mostrado no grid principal da home. */
export interface CardPendencia {
  titulo: string;
  contagem: number;
  subtitulo: string;
  href: string;
  icone: LucideIcon;
}

/** Card de KPI mostrado na linha inferior da home. */
export interface CardKpi {
  titulo: string;
  valor: string;
  subtitulo: string;
  href: string;
  icone: LucideIcon;
}

/** Payload que cada `carregarHome<Papel>` devolve. */
export interface DadosHome {
  pendencias: CardPendencia[];
  kpis: CardKpi[];
}
