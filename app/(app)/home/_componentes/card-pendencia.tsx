import Link from "next/link";
import type { CardPendencia } from "@/lib/home/tipos";

/**
 * Card de pendencia da home: titulo, contagem grande, subtitulo, icone.
 * O card inteiro e clicavel e leva pra tela destino. `prefetch={false}`
 * porque um grid de 5-8 cards prefetching em viewport satura o pool
 * de serverless functions (regra A do docs/PERFORMANCE.md).
 */
export function CardPendenciaLink({ card }: { card: CardPendencia }) {
  const Icone = card.icone;
  return (
    <Link
      href={card.href}
      prefetch={false}
      className="group rounded-2xl border border-border bg-card p-5 shadow-soft hover:border-california-red/30 hover:shadow-brand transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-california-red/10 text-california-red">
          <Icone className="h-4 w-4" />
        </div>
        <div className="text-3xl font-bold tabular-nums text-foreground">
          {card.contagem}
        </div>
      </div>
      <div className="mt-4">
        <p className="text-sm font-semibold text-foreground group-hover:text-california-red transition-colors">
          {card.titulo}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {card.subtitulo}
        </p>
      </div>
    </Link>
  );
}
