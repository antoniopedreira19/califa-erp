import { MapPin } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { valoresDoRateio } from "@/lib/calculos/rateio-regional";

interface RateioItem {
  regional_id: string;
  percentual: number;
}

interface Props {
  rateio: RateioItem[];
  valorTotal: number;
  regionaisPorId: Map<string, { nome: string; ativo: boolean }>;
}

function formatPct(n: number): string {
  return n.toFixed(2);
}

export function RateioCard({ rateio, valorTotal, regionaisPorId }: Props) {
  if (rateio.length === 0) return null;

  // A diferença do arredondamento fica com a regional de maior percentual
  // (no empate, a primeira em ordem alfabética), a mesma regra do fluxo de
  // caixa. Antes ia para a última linha, numa ordem que o banco não garante.
  const valores = valoresDoRateio(
    rateio.map((r) => ({
      percentual: r.percentual,
      nome: regionaisPorId.get(r.regional_id)?.nome,
    })),
    valorTotal,
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
        <MapPin className="mr-1.5 inline-block h-4 w-4" />
        Rateio de regional
      </h2>
      <div className="space-y-1.5">
        {rateio.map((r, idx) => {
          const reg = regionaisPorId.get(r.regional_id);
          return (
            <div
              key={r.regional_id}
              className="flex items-center justify-between text-sm"
            >
              <span className={reg?.ativo === false ? "text-muted-foreground" : ""}>
                {reg?.nome ?? "—"}
                {reg?.ativo === false ? " (inativa)" : ""}
              </span>
              <span className="flex items-center gap-4">
                <span className="w-16 text-right font-mono text-xs">
                  {formatPct(r.percentual)}%
                </span>
                <span className="w-32 text-right font-mono text-xs font-semibold">
                  {formatCurrency(valores[idx], "BRL")}
                </span>
              </span>
            </div>
          );
        })}
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
          <span>Total</span>
          <span className="flex items-center gap-4">
            <span className="w-16 text-right font-mono text-xs">100.00%</span>
            <span className="w-32 text-right font-mono text-xs">
              {formatCurrency(valorTotal, "BRL")}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
