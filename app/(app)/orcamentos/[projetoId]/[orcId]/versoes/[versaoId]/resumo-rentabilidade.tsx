import { cn, formatCurrency } from "@/lib/utils";

interface Props {
  /** Compromisso total do cliente — base do resultado. */
  valorJob: number;
  /** Valor do job − impostos − custo planejado (+ BVs). `null` = planejado
   *  não lançado, então a conta não existe. */
  resultadoOperacional: number | null;
  /** Resultado operacional ÷ valor do job. `null` = planejado não lançado. */
  resultadoGeral: number | null;
  moeda: string;
}

/**
 * Resumo de receita × resultado no cabeçalho da versão: a produção enxerga a
 * rentabilidade enquanto monta o orçamento, sem precisar rolar até o card
 * de Totais. Os números vêm dos mesmos cálculos daquele card.
 *
 * Desde 04/09/2026 o bloco do meio mostra o **resultado operacional** em vez
 * do custo planejado — o custo sozinho não dizia se o orçamento fechava. Em
 * orçamento só existe o cenário planejado, então é um bloco só.
 */
export function ResumoRentabilidade({
  valorJob,
  resultadoOperacional,
  resultadoGeral,
  moeda,
}: Props) {
  return (
    <div className="flex divide-x divide-border rounded-xl border border-border bg-card shadow-soft">
      <Bloco label="Valor do Job">
        <span className="font-mono text-base font-bold text-foreground">
          {formatCurrency(valorJob, moeda)}
        </span>
      </Bloco>

      <Bloco label="Resultado Op. (Planejado)">
        {resultadoOperacional === null ? (
          <span className="font-mono text-base font-bold text-muted-foreground">
            —
          </span>
        ) : (
          <span
            className={cn(
              "font-mono text-base font-bold",
              resultadoOperacional >= 0
                ? "text-emerald-700"
                : "text-california-red",
            )}
          >
            {formatCurrency(resultadoOperacional, moeda)}
          </span>
        )}
      </Bloco>

      <Bloco label="Resultado geral">
        {resultadoGeral === null ? (
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono text-base font-bold text-muted-foreground">
              —
            </span>
            <span className="text-[10px] text-muted-foreground">
              sem planejado
            </span>
          </span>
        ) : (
          <span
            className={cn(
              "font-mono text-base font-bold",
              resultadoGeral >= 0 ? "text-emerald-700" : "text-california-red",
            )}
          >
            {`${resultadoGeral.toFixed(1).replace(".", ",")}%`}
          </span>
        )}
      </Bloco>
    </div>
  );
}

function Bloco({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-2.5">
      <p className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 whitespace-nowrap leading-none">{children}</p>
    </div>
  );
}
