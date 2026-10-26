/** Skeleton da DRE do histórico: os filtros e as linhas da DRE. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-4 w-40 animate-pulse rounded bg-muted/60" />
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">Relatórios · DRE do histórico</p>
        <div className="h-10 w-96 animate-pulse rounded bg-muted" />
        <div className="mt-1 h-4 w-[32rem] max-w-full animate-pulse rounded bg-muted/60" />
      </header>

      <div className="h-16 animate-pulse rounded-2xl border border-border bg-card shadow-soft" />

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <div className="h-11 border-b border-border bg-muted/40" />
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
            <div className="h-4 w-64 animate-pulse rounded bg-muted/60" />
            {Array.from({ length: 5 }).map((__, k) => (
              <div key={k} className={k === 0 ? "ml-auto h-4 w-24 animate-pulse rounded bg-muted/60" : "h-4 w-24 animate-pulse rounded bg-muted/60"} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
