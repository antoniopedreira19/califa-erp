import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import type { Cliente } from "@/lib/types";
import { OrcamentoForm } from "../orcamento-form";

export const dynamic = "force-dynamic";

export default async function NovoOrcamentoPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [clientesRes, responsaveis] = await Promise.all([
    supabase
      .from("clientes")
      .select("id, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    listActiveMembers(session.activeTenant.id),
  ]);

  const clientes = (clientesRes.data ?? []) as Pick<Cliente, "id" | "nome_fantasia">[];

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Link
          href="/orcamentos"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para orçamentos
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Novo orçamento</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Registre a oportunidade comercial. Versões e itens vêm na próxima task.
        </p>
      </div>

      {clientes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground text-center">
          Você precisa cadastrar pelo menos um cliente antes de criar orçamentos.{" "}
          <Link href="/clientes/novo" className="text-california-red font-semibold hover:underline">
            Criar cliente
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <OrcamentoForm clientes={clientes} responsaveis={responsaveis} />
        </div>
      )}
    </div>
  );
}
