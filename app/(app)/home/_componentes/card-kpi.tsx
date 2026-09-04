import Link from "next/link";
import type { CardKpi } from "@/lib/home/tipos";

/**
 * Card de KPI da home: numero de destaque + rotulo. Menor que CardPendencia
 * pra caber 4 em linha sem estourar. Zero nao some (diferente do card de
 * pendencia) — numero zero e informacao.
 */
export function CardKpiLink({ card }: { card: CardKpi }) {
  const Icone = card.icone;
  return (
    <Link
      href={card.href}
      prefetch={false}
      className="group rounded-xl border border-border bg-card p-4 shadow-soft hover:border-california-red/30 transition-colors"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icone className="h-3.5 w-3.5" />
        <span>{card.titulo}</span>
      </div>
      <div className="mt-2 text-xl font-bold tabular-nums text-foreground group-hover:text-california-red transition-colors">
        {card.valor}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {card.subtitulo}
      </p>
    </Link>
  );
}
