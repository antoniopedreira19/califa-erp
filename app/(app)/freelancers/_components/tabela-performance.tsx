import Link from "next/link";
import { TrendingUp, ArrowRight } from "lucide-react";
import { cn, initials } from "@/lib/utils";

export interface PerformanceLinha {
  responsavel_id: string;
  nome: string;
  total: number;
  regulares: number;
  irregulares: number;
  score: number; // 0-100
}

export function TabelaPerformance({
  linhas,
}: {
  linhas: PerformanceLinha[];
}) {
  if (linhas.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-white shadow-soft overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-california-red/10 text-california-red">
          <TrendingUp className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground">
            Performance por responsável
          </h2>
          <p className="text-xs text-muted-foreground">
            Score = % de freelancers em status regular
          </p>
        </div>
      </div>
      <table className="w-full text-xs">
        <thead className="bg-muted/20 border-b border-border">
          <tr>
            <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-[0.08em] text-muted-foreground text-[10px]">
              Responsável
            </th>
            <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-[0.08em] text-muted-foreground text-[10px]">
              Total
            </th>
            <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-[0.08em] text-muted-foreground text-[10px]">
              Regulares
            </th>
            <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-[0.08em] text-muted-foreground text-[10px]">
              Em alerta
            </th>
            <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-[0.08em] text-muted-foreground text-[10px]">
              Score
            </th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr
              key={l.responsavel_id}
              className="border-b border-border last:border-0 hover:bg-california-red/[0.02] transition-colors group"
            >
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-california-red/10 text-california-red text-[10px] font-bold">
                    {initials(l.nome)}
                  </div>
                  <span className="font-semibold text-foreground">{l.nome}</span>
                </div>
              </td>
              <td className="px-3 py-2.5 text-center tabular-nums text-foreground">
                {l.total}
              </td>
              <td className="px-3 py-2.5 text-center tabular-nums text-emerald-700">
                {l.regulares}
              </td>
              <td className="px-3 py-2.5 text-center tabular-nums text-california-red">
                {l.irregulares}
              </td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden max-w-[180px]">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        l.score >= 80
                          ? "bg-emerald-500"
                          : l.score >= 50
                            ? "bg-amber-500"
                            : "bg-california-red",
                      )}
                      style={{ width: `${l.score}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold tabular-nums w-10 text-right">
                    {l.score}%
                  </span>
                </div>
              </td>
              <td className="px-2 py-2.5 text-right">
                <Link
                  href={`/freelancers/lista?responsavel=${l.responsavel_id}`}
                  prefetch={false}
                  aria-label={`Ver freelancers de ${l.nome}`}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-california-red hover:bg-california-red/10 transition-colors"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
