import { Users, Clock, Palmtree, AlertTriangle } from "lucide-react";

type Accent = "sky" | "amber" | "emerald" | "rose";

const ACCENT_CLASSES: Record<Accent, { icon: string; bg: string }> = {
  sky: { icon: "text-sky-600", bg: "bg-sky-50" },
  amber: { icon: "text-amber-600", bg: "bg-amber-50" },
  emerald: { icon: "text-emerald-600", bg: "bg-emerald-50" },
  rose: { icon: "text-rose-600", bg: "bg-rose-50" },
};

export function KpiCardsEquipe({
  liderados,
  aguardandoVoce,
  feriasHoje,
  vencendo60d,
}: {
  liderados: number;
  aguardandoVoce: number;
  feriasHoje: number;
  vencendo60d: number;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        icon={Users}
        label="Liderados"
        value={liderados.toString()}
        hint={liderados === 1 ? "colaborador reporta a você" : "colaboradores reportam a você"}
        accent="sky"
      />
      <KpiCard
        icon={Clock}
        label="Aguardando sua aprovação"
        value={aguardandoVoce.toString()}
        hint={aguardandoVoce === 1 ? "solicitação de férias" : "solicitações de férias"}
        accent="amber"
      />
      <KpiCard
        icon={Palmtree}
        label="De férias hoje"
        value={feriasHoje.toString()}
        hint={feriasHoje === 1 ? "colaborador fora" : "colaboradores fora"}
        accent="emerald"
      />
      <KpiCard
        icon={AlertTriangle}
        label="Vencendo em 60 dias"
        value={vencendo60d.toString()}
        hint={vencendo60d === 1 ? "período aquisitivo" : "períodos aquisitivos"}
        accent="rose"
      />
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint: string;
  accent: Accent;
}) {
  const classes = ACCENT_CLASSES[accent];
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${classes.bg}`}
        >
          <Icon className={`h-5 w-5 ${classes.icon}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
    </div>
  );
}
