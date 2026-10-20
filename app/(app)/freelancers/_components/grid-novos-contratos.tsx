import Link from "next/link";
import { Calendar, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  totais: {
    "7d": number;
    "15d": number;
    "30d": number;
    "60d": number;
  };
  /** 'horizontal' = 4 colunas (default); 'vertical' = 4 linhas empilhadas. */
  orientacao?: "horizontal" | "vertical";
}

const JANELAS: Array<{
  key: keyof Props["totais"];
  label: string;
  dias: number;
}> = [
  { key: "7d", label: "Última semana", dias: 7 },
  { key: "15d", label: "Últimos 15 dias", dias: 15 },
  { key: "30d", label: "Últimos 30 dias", dias: 30 },
  { key: "60d", label: "Últimos 60 dias", dias: 60 },
];

export function GridNovosContratos({
  totais,
  orientacao = "horizontal",
}: Props) {
  const vertical = orientacao === "vertical";
  return (
    <div className="rounded-2xl border border-border bg-white shadow-soft overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-california-red/10 text-california-red">
          <Calendar className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground">Novos contratos</h2>
          <p className="text-xs text-muted-foreground">
            {vertical
              ? "Janelas recentes — clique pra filtrar"
              : "Contratos iniciados em janelas recentes — clique pra filtrar a lista"}
          </p>
        </div>
      </div>
      <div
        className={cn(
          vertical
            ? "flex flex-col divide-y divide-border"
            : "grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-border",
        )}
      >
        {JANELAS.map((j) => {
          const n = totais[j.key];
          const inicioApos = calcularInicioApos(j.dias);
          return (
            <Link
              key={j.key}
              href={`/freelancers/lista?inicio_apos=${inicioApos}`}
              prefetch={false}
              className="group flex flex-col gap-2 px-5 py-4 hover:bg-california-red/[0.03] transition-colors"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {j.label}
              </p>
              <div className="flex items-end justify-between">
                <p
                  className={cn(
                    "text-3xl font-bold tabular-nums",
                    n > 0 ? "text-foreground" : "text-muted-foreground/40",
                  )}
                >
                  {n}
                </p>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-california-red group-hover:translate-x-0.5 transition-all" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function calcularInicioApos(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}
