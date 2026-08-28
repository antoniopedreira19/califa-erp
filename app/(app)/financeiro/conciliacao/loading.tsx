import { Receipt } from "lucide-react";

/**
 * Skeleton mostrado enquanto o server component da conciliação renderiza.
 * Convive com o `useTransition` de FiltrosConta: em navegação inicial ou
 * hard refresh este é o skeleton; ao trocar filtro o UI antigo permanece
 * com opacidade reduzida (via `data-pending` na section dos filtros).
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-4 w-40 animate-pulse rounded bg-muted/60" />

      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Receipt className="h-5 w-5 text-california-red" />
          </div>
          <div className="h-9 w-56 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-4 w-[28rem] max-w-full animate-pulse rounded bg-muted/60" />
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="min-w-[280px] flex-1 space-y-1">
          <div className="h-3 w-24 animate-pulse rounded bg-muted/60" />
          <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
        </div>
        <div className="space-y-1">
          <div className="h-3 w-8 animate-pulse rounded bg-muted/60" />
          <div className="h-10 w-40 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="space-y-1">
          <div className="h-3 w-8 animate-pulse rounded bg-muted/60" />
          <div className="h-10 w-40 animate-pulse rounded-md bg-muted" />
        </div>
      </div>

      {/* Cards de saldo */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-card p-4 space-y-2"
          >
            <div className="h-3 w-32 animate-pulse rounded bg-muted/60" />
            <div className="h-7 w-40 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Tabela */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="h-10 border-b border-border bg-muted/40" />
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border px-3 py-3 last:border-0"
          >
            <div className="h-4 w-14 animate-pulse rounded bg-muted/60" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted/60" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted/60" />
            <div className="h-4 w-24 animate-pulse rounded bg-muted/60" />
            <div className="h-4 w-64 animate-pulse rounded bg-muted/60" />
            <div className="ml-auto h-7 w-7 animate-pulse rounded-full bg-muted/60" />
          </div>
        ))}
      </div>
    </div>
  );
}
