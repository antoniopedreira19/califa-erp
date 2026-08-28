/**
 * Skeleton que aparece enquanto o server component desta rota está sendo
 * renderizado. Substitui o "conteúdo antigo travado" que dava sensação de
 * página bloqueada quando o usuário trocava filtros.
 *
 * Convive com o `useTransition` do FiltrosCliente: em navegação inicial ou
 * hard refresh esta é a tela; em troca de filtro subsequente, o Next mantém
 * o UI antigo com opacidade reduzida (via `data-pending` na section dos
 * filtros) até o novo render chegar.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Relatórios · Rentabilidade
        </p>
        <div className="h-10 w-96 animate-pulse rounded bg-muted" />
        <div className="mt-1 h-4 w-[32rem] max-w-full animate-pulse rounded bg-muted/60" />
      </header>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-soft space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 w-24 animate-pulse rounded bg-muted/60" />
              <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
          <div className="h-9 w-40 animate-pulse rounded-lg bg-muted" />
          <div className="h-9 w-56 animate-pulse rounded-lg bg-muted" />
          <div className="h-6 w-44 animate-pulse rounded bg-muted" />
        </div>
      </section>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <div className="h-11 border-b border-border bg-muted/40" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
            <div className="h-4 w-40 animate-pulse rounded bg-muted/60" />
            <div className="ml-auto h-4 w-24 animate-pulse rounded bg-muted/60" />
            <div className="h-4 w-24 animate-pulse rounded bg-muted/60" />
            <div className="h-5 w-14 animate-pulse rounded bg-muted/60" />
            <div className="h-5 w-14 animate-pulse rounded bg-muted/60" />
          </div>
        ))}
      </div>
    </div>
  );
}
