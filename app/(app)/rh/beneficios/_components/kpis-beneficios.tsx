import { HeartPulse, Smile, Building2, UserRound } from "lucide-react";
import type { BeneficioKpisTenant } from "@/lib/types";

const formatarBrl = (n: number) =>
  n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });

export function KpisBeneficios({ kpis }: { kpis: BeneficioKpisTenant }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        icon={HeartPulse}
        label="Plano de saúde"
        value={kpis.qtde_vinculos_saude.toString()}
        hint={kpis.qtde_vinculos_saude === 1 ? "vínculo ativo" : "vínculos ativos"}
        accent="rose"
      />
      <KpiCard
        icon={Smile}
        label="Dental"
        value={kpis.qtde_vinculos_dental.toString()}
        hint={kpis.qtde_vinculos_dental === 1 ? "vínculo ativo" : "vínculos ativos"}
        accent="sky"
      />
      <KpiCard
        icon={Building2}
        label="Custo mensal — California"
        value={formatarBrl(Number(kpis.custo_total_empresa))}
        hint="o que a empresa paga nesta competência"
        accent="emerald"
      />
      <KpiCard
        icon={UserRound}
        label="Desconto mensal — colaboradores"
        value={formatarBrl(Number(kpis.custo_total_colaboradores))}
        hint="total que sai da folha dos colaboradores"
        accent="amber"
      />
    </div>
  );
}

type Accent = "rose" | "sky" | "emerald" | "amber";

const ACCENT_CLASSES: Record<Accent, { icon: string; bg: string }> = {
  rose: { icon: "text-rose-600", bg: "bg-rose-50" },
  sky: { icon: "text-sky-600", bg: "bg-sky-50" },
  emerald: { icon: "text-emerald-600", bg: "bg-emerald-50" },
  amber: { icon: "text-amber-600", bg: "bg-amber-50" },
};

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: typeof HeartPulse;
  label: string;
  value: string;
  hint: string;
  accent: Accent;
}) {
  const classes = ACCENT_CLASSES[accent];
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold text-foreground truncate">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${classes.bg}`}
        >
          <Icon className={`h-5 w-5 ${classes.icon}`} />
        </div>
      </div>
    </div>
  );
}
