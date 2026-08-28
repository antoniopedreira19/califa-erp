import Link from "next/link";
import { BarChart3, ArrowRight, TrendingUp, FileText, type LucideIcon } from "lucide-react";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function RelatoriosPage() {
  await requireSession();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Relatórios
        </p>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <BarChart3 className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Relatórios gerenciais</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Dashboards de leitura sobre operação e financeiro. Novos relatórios aparecem
          aqui à medida que os módulos vão sendo liberados.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <RelatorioCard
          href="/relatorios/rentabilidade"
          icon={TrendingUp}
          title="Rentabilidade de Jobs"
          description="Faturamento, resultado operacional e rentabilidade por cliente, marca ou job. Comparativo entre períodos."
        />
        <RelatorioCard
          href="/relatorios/faturamento"
          icon={FileText}
          title="Faturamento de Jobs"
          description="Valor contratado × valor faturado por job, com saldo e status (Não Faturado, Parcial, Faturado)."
        />
      </div>
    </div>
  );
}

function RelatorioCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="group relative flex flex-col rounded-2xl border border-border bg-card p-6 shadow-soft transition-all hover:border-california-red/30 hover:shadow-elevated"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
        <Icon className="h-5 w-5" />
      </div>

      <h3 className="mt-4 text-lg font-semibold text-foreground group-hover:text-california-red transition-colors">
        {title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">Dashboard</span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
          Abrir
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
