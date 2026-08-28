import Link from "next/link";
import { ChevronRight, Wallet } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { ContaBancaria, Empresa } from "@/lib/types";
import { ContasBancariasList } from "./contas-bancarias-list";

export const dynamic = "force-dynamic";

type ContaBancariaComEmpresa = ContaBancaria & {
  empresas: {
    razao_social: string;
    nome_fantasia: string | null;
  };
};

export default async function ContasBancariasPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [contasRes, empresasRes] = await Promise.all([
    supabase
      .from("contas_bancarias")
      .select("*, empresas!inner(razao_social, nome_fantasia)")
      .eq("tenant_id", session.activeTenant.id)
      // A conta do cartão não se cadastra aqui: ela nasce e morre com o
      // cartão, pelo trigger. Editá-la ou apagá-la por esta tela deixaria
      // o cartão sem onde lançar compra (28/08/2026).
      .is("cartao_credito_id", null)
      .order("ordem", { ascending: true })
      .order("nome", { ascending: true })
      .returns<ContaBancariaComEmpresa[]>(),
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("razao_social", { ascending: true })
      .returns<Pick<Empresa, "id" | "razao_social" | "nome_fantasia">>(),
  ]);

  if (contasRes.error) console.error("[contas_bancarias.page]", contasRes.error.message);
  if (empresasRes.error) console.error("[contas_bancarias.empresas]", empresasRes.error.message);

  const contas = contasRes.data ?? [];
  const empresas = (empresasRes.data as Pick<Empresa, "id" | "razao_social" | "nome_fantasia">[] | null) ?? [];
  const canEdit = ["administrador", "financeiro"].includes(session.activeRole);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <nav className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Link href="/cadastros" className="hover:text-foreground">
            Cadastros
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span>Contas bancárias</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Wallet className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Contas bancárias</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Contas onde os pagamentos entram e saem, com saldo inicial e empresa associada.
        </p>
      </header>

      <ContasBancariasList
        contas={contas}
        empresas={empresas}
        canEdit={canEdit}
      />
    </div>
  );
}
