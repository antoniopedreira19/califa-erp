import Link from "next/link";
import { redirect } from "next/navigation";
import { Landmark, Clock, ArrowRight, FileText, Receipt, Wallet, TrendingUp, type LucideIcon } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CentralFinanceiraPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  const [aguardandoRes, ppsRes, aPagarRes] = await Promise.all([
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "aguardando_abertura"),
    supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "em_avaliacao"),
    supabase
      .from("vw_a_pagar")
      .select("origem_id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id),
  ]);
  const aguardandoCount = aguardandoRes.count;
  const ppsCount = ppsRes.count;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Financeiro
        </p>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Landmark className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Central Financeira</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Ponto central pra decisões financeiras. Mais cards (DRE, conciliação, aprovações) chegam nas próximas fases.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <FinanceiroCard
          href="/financeiro/abertura-de-job"
          icon={Clock}
          title="Abertura de Job"
          description="Confira os jobs enviados pela produção e complete o registro financeiro para abri-los."
          count={aguardandoCount ?? 0}
        />
        <FinanceiroCard
          href="/financeiro/contas-a-pagar"
          icon={FileText}
          title="Caixa de entrada"
          description="Pedidos de Compra aguardando avaliação — aprovar ou rejeitar."
          count={ppsCount ?? 0}
        />
        <FinanceiroCard
          href="/financeiro/a-pagar"
          icon={Wallet}
          title="A pagar"
          description="Aprovados aguardando pagamento — dar baixa quando o dinheiro sair."
          count={aPagarRes.count ?? 0}
        />
        <FinanceiroCard
          href="/financeiro/fluxo-caixa"
          icon={TrendingUp}
          title="Fluxo de caixa"
          description="Previsto + realizado por dia, semana ou mês, com saldo projetado."
        />
        <FinanceiroCard
          href="/financeiro/conciliacao"
          icon={Receipt}
          title="Conciliação Bancária"
          description="Extrato por conta bancária. Base pra bater com o extrato do banco e pra o DRE."
        />
        {/* Cards futuros: DRE, aprovações de pagamentos */}
      </div>
    </div>
  );
}

function FinanceiroCard({
  href,
  icon: Icon,
  title,
  description,
  count,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  count?: number;
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
      {count !== undefined && (
        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{count}</span>{" "}
            {count === 1 ? "pendente" : "pendentes"}
          </p>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
            Abrir
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      )}
      {count === undefined && (
        <div className="mt-6 flex items-center justify-end border-t border-border pt-4">
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
            Abrir
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      )}
    </Link>
  );
}
