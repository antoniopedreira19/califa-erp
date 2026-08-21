import { redirect } from "next/navigation";
import { CreditCard, ChevronRight } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { CartoesList } from "./cartoes-list";
import type { CartaoCredito } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CartoesCreditoPage() {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/cadastros?reason=sem_permissao");
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("cartoes_credito")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .order("ativo", { ascending: false })
    .order("nome")
    .returns<CartaoCredito[]>();

  if (error) console.error("[cadastros.cartoes]", error.message);

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link
            href="/cadastros"
            className="hover:text-california-red transition-colors"
          >
            Cadastros
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">Cartões de Crédito</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <CreditCard className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Cartões de Crédito
          </h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl text-pretty">
          Cartões usados como forma de pagamento em PPs, contas avulsas e
          recorrências. O dia de vencimento da fatura preenche a data de
          pagamento dos títulos automaticamente.
        </p>
      </header>

      <CartoesList rows={data ?? []} />
    </div>
  );
}
