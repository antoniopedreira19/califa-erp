import Link from "next/link";
import { ArrowRight, ChevronRight, Wallet, ListTree, CreditCard, FolderKanban, type LucideIcon } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CadastrosFinanceiroPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [contasBancariasRes, tiposPlanoRes, cartoesCreditoRes] = await Promise.all([
    supabase
      .from("contas_bancarias")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    supabase
      .from("plano_contas_tipos")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    supabase
      .from("cartoes_credito")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
  ]);

  if (contasBancariasRes.error) console.error("[fin-cadastros.contas_bancarias]", contasBancariasRes.error.message);
  if (tiposPlanoRes.error) console.error("[fin-cadastros.plano_contas_tipos]", tiposPlanoRes.error.message);
  if (cartoesCreditoRes.error) console.error("[fin-cadastros.cartoes_credito]", cartoesCreditoRes.error.message);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <nav className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Link href="/financeiro" className="hover:text-foreground">
            Central Financeira
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span>Cadastros</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <FolderKanban className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Cadastros do Financeiro</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Estruturas de base pra operar o financeiro: onde o dinheiro entra e
          sai, como classificar cada lançamento e que cartões existem.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <CadastroCard
          href="/financeiro/cadastros/contas-bancarias"
          icon={Wallet}
          title="Contas bancárias"
          description="Contas onde os pagamentos entram e saem, com saldo inicial e empresa associada."
          count={contasBancariasRes.count ?? 0}
        />
        <CadastroCard
          href="/financeiro/cadastros/plano-de-contas"
          icon={ListTree}
          title="Plano de contas"
          description="Tipos e subtipos usados para classificar cada lançamento financeiro. Base do DRE."
          count={tiposPlanoRes.count ?? 0}
        />
        <CadastroCard
          href="/financeiro/cadastros/cartoes-credito"
          icon={CreditCard}
          title="Cartões de crédito"
          description="Cartões usados como forma de pagamento. O dia da fatura preenche a data de pagamento dos títulos automaticamente."
          count={cartoesCreditoRes.count ?? 0}
        />
      </div>
    </div>
  );
}

function CadastroCard({
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
  count: number;
}) {
  return (
    <Link
      href={href}
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
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{count}</span>{" "}
          {count === 1 ? "ativo" : "ativos"}
        </p>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
          Abrir
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
