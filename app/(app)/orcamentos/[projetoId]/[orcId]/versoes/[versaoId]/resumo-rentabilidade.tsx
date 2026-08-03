import { cn, formatCurrency } from "@/lib/utils";

interface Props {
  /** Custos + honorários + impostos — o que o cliente paga. */
  faturamento: number;
  /** Soma do planejado dos itens: o desembolso esperado da agência. */
  custoPlanejado: number;
  /** Resultado operacional ÷ faturamento. `null` = planejado não lançado. */
  resultadoGeral: number | null;
  moeda: string;
}

/**
 * Resumo de receita × custos no cabeçalho da versão: a produção enxerga a
 * rentabilidade enquanto monta o orçamento, sem precisar rolar até o card
 * de Totais. Os números vêm dos mesmos cálculos daquele card.
 */
export function ResumoRentabilidade({
  faturamento,
  custoPlanejado,
  resultadoGeral,
  moeda,
}: Props) {
  const semPlanejado = custoPlanejado <= 0;

  return (
    <div className="flex divide-x divide-border rounded-xl border border-border bg-card shadow-soft">
      <Bloco label="Faturamento previsto">
        <span className="font-mono text-base font-bold text-foreground">
          {formatCurrency(faturamento, moeda)}
        </span>
      </Bloco>

      <Bloco label="Custo planejado">
        {semPlanejado ? (
          <span className="font-mono text-base font-bold text-muted-foreground">
            —
          </span>
        ) : (
          <span className="font-mono text-base font-bold text-foreground">
            {formatCurrency(custoPlanejado, moeda)}
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
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 whitespace-nowrap leading-none">{children}</p>
    </div>
  );
}
