import Link from "next/link";
import { ArrowLeft, Wallet } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { ContaBancaria, EmpresaContabil } from "@/lib/types";
import { ContasBancariasList } from "./contas-bancarias-list";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * Sem embed de `empresas`: a conta não pertence a uma empresa desde
 * 09/09/2026, e o `!inner` que morava aqui faria toda conta nova (sem
 * empresa) sumir da lista em silêncio.
 */

export default async function ContasBancariasPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [contasRes, contabeisRes] = await Promise.all([
    supabase
      .from("contas_bancarias")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      // A conta do cartão não se cadastra aqui: ela nasce e morre com o
      // cartão, pelo trigger. Editá-la ou apagá-la por esta tela deixaria
      // o cartão sem onde lançar compra (28/08/2026).
      .is("cartao_credito_id", null)
      .order("ordem", { ascending: true })
      .order("nome", { ascending: true })
      .returns<ContaBancaria[]>(),
    supabase
      .from("empresas_contabeis")
      .select("id, razao_social, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("razao_social")
      .returns<Pick<EmpresaContabil, "id" | "razao_social" | "nome_fantasia">[]>(),
  ]);

  if (contasRes.error) console.error("[contas_bancarias.page]", contasRes.error.message);
  if (contabeisRes.error) console.error("[contas_bancarias.page/contabeis]", contabeisRes.error.message);

  const contas = contasRes.data ?? [];
  const empresasContabeis = contabeisRes.data ?? [];
  const canEdit = ["administrador", "financeiro"].includes(session.activeRole);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/financeiro/cadastros"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para cadastros do financeiro
        </Link>
        <PageHeader
          eyebrow="FINANCEIRO"
          title="Contas bancárias"
          description="Contas onde os pagamentos entram e saem, com saldo inicial. A conta serve a qualquer empresa — a empresa é do documento que está sendo pago."
          icon={Wallet}
        />
      </div>

      <ContasBancariasList contas={contas} canEdit={canEdit} empresasContabeis={empresasContabeis} />
    </div>
  );
}
