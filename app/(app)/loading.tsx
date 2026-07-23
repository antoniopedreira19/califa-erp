import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading UI mostrada instantaneamente enquanto o server component da
 * página real ainda está fazendo queries no Supabase (TTFB + streaming
 * do RSC somam ~1-2s em páginas force-dynamic).
 *
 * O layout (app) — sidebar, container principal — não recarrega entre
 * navegações no App Router. Este componente só preenche o {children}
 * do layout, então basta espelhar a estrutura típica de header + bloco
 * de filtros + lista/grid que aparece em quase todas as páginas.
 *
 * Genérico de propósito: quando o conteúdo real chega em ~500ms-2s,
 * ele substitui esse skeleton sem "flash" perceptível na maioria das
 * páginas. Se alguma tela tiver layout muito distinto e este skeleton
 * ficar estranho, criar um loading.tsx local na pasta dela.
 */
export default function AppLoading() {
  return (
    <div className="space-y-8">
      {/* Header — eyebrow + título + descrição */}
      <header className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </header>

      {/* Bloco de filtros / barra de ação (busca + selects + botão) */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <Skeleton className="h-11 flex-1 md:max-w-sm" />
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-11 w-40" />
          <Skeleton className="h-11 w-40" />
        </div>
      </div>

      {/* Grid de cards / lista — deixamos 4 blocos genéricos */}
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-soft"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
