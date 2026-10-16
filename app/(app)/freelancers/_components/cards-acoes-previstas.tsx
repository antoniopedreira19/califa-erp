import Link from "next/link";
import { cn } from "@/lib/utils";

type AcaoKey = "contratar" | "renovar" | "manter" | "substituir" | "encerrar";

interface Totais {
  contratar: number;
  renovar: number;
  manter: number;
  substituir: number;
  encerrar: number;
}

const CARDS: Array<{
  key: AcaoKey;
  label: string;
  descricao: string;
  cor: string;
  dot: string;
  barra: string;
}> = [
  {
    key: "contratar",
    label: "Contratar",
    descricao: "Freelas pra puxar pra equipe",
    cor: "text-sky-700",
    dot: "bg-sky-500",
    barra: "bg-sky-500",
  },
  {
    key: "renovar",
    label: "Renovar",
    descricao: "Contratos chegando ao fim",
    cor: "text-emerald-700",
    dot: "bg-emerald-500",
    barra: "bg-emerald-500",
  },
  {
    key: "manter",
    label: "Manter",
    descricao: "Mantém como está",
    cor: "text-violet-700",
    dot: "bg-violet-500",
    barra: "bg-violet-500",
  },
  {
    key: "substituir",
    label: "Substituir",
    descricao: "Trocar quando possível",
    cor: "text-amber-700",
    dot: "bg-amber-500",
    barra: "bg-amber-500",
  },
  {
    key: "encerrar",
    label: "Encerrar",
    descricao: "Não contratar mais",
    cor: "text-california-red",
    dot: "bg-california-red",
    barra: "bg-california-red",
  },
];

export function CardsAcoesPrevistas({ totais }: { totais: Totais }) {
  const total =
    totais.contratar +
    totais.renovar +
    totais.manter +
    totais.substituir +
    totais.encerrar;

  if (total === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-white shadow-soft">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-bold text-foreground">Ações previstas</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Decisões do RH/GP sobre o próximo passo com cada freelancer
        </p>
      </div>
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {CARDS.map((c) => {
          const n = totais[c.key];
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          return (
            <Link
              key={c.key}
              href={`/freelancers/lista?acao=${c.key}`}
              prefetch={false}
              className="group rounded-2xl border border-border bg-white p-4 shadow-soft hover:shadow-elevated hover:-translate-y-0.5 transition-all"
            >
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full shrink-0", c.dot)} />
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground">
                  {c.label}
                </span>
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                  {pct}%
                </span>
              </div>
              <p className={cn("mt-2 text-3xl font-bold tabular-nums", c.cor)}>
                {n}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {c.descricao}
              </p>
              <div className="mt-3 h-1 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full transition-all", c.barra)}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
