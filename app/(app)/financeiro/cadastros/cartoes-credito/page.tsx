import { redirect } from "next/navigation";
import { CreditCard, ArrowLeft } from "lucide-react";
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
  // As duas em paralelo, nunca em série (docs/PERFORMANCE.md).
  const [{ data, error }, empresasRes] = await Promise.all([
    supabase
      .from("cartoes_credito")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("ativo", { ascending: false })
      .order("nome")
      .returns<CartaoCredito[]>(),
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("principal", { ascending: false })
      .order("razao_social"),
  ]);

  if (error) console.error("[cadastros.cartoes]", error.message);
  if (empresasRes.error) {
    console.error("[cadastros.cartoes.empresas]", empresasRes.error.message);
  }

  const empresas = (empresasRes.data ?? []).map(
    (e: { id: string; razao_social: string; nome_fantasia: string | null }) => ({
      id: e.id,
      nome: e.nome_fantasia ?? e.razao_social,
    }),
  );

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <Link
          href="/financeiro/cadastros"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para cadastros do financeiro
        </Link>
        <header className="mt-3 space-y-2">
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
      </div>

      <CartoesList rows={data ?? []} empresas={empresas} />
    </div>
  );
}
