import { redirect } from "next/navigation";
import { CreditCard, } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { CartoesList } from "./cartoes-list";
import type { CartaoCredito } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";

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
        <BotaoVoltar reserva="/financeiro/cadastros" className="mb-3" />
        <PageHeader
          eyebrow="FINANCEIRO"
          title="Cartões de Crédito"
          description="Cartões usados como forma de pagamento em PPs, contas avulsas e recorrências. O dia de vencimento da fatura preenche a data de pagamento dos títulos automaticamente."
          icon={CreditCard}
        />
      </div>

      <CartoesList rows={data ?? []} empresas={empresas} />
    </div>
  );
}
