import Link from "next/link";
import { Users, Plus, ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Cliente } from "@/lib/types";
import { EmptyState } from "@/components/empty-state";
import { ClientesList } from "./clientes-list";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const session = await requireSession();
  const supabase = createClient();

  const { data: clientes, error } = await supabase
    .from("clientes")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .order("nome_fantasia", { ascending: true })
    .returns<Cliente[]>();

  if (error) {
    console.error("[clientes.page]", error.message);
  }

  const rows = clientes ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/cadastros"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para cadastros
        </Link>
        <header className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-california-red/10 p-2">
                <Users className="h-5 w-5 text-california-red" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">Clientes</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Empresas para as quais a agência produz orçamentos. Cliente ativo
              aparece na criação de orçamento.
            </p>
          </div>
          <Link
            href="/clientes/novo"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
          >
            <Plus className="h-4 w-4" />
            Novo cliente
          </Link>
        </header>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum cliente cadastrado"
          description="Crie o primeiro cliente para poder abrir orçamentos."
          action={
            <Link
              href="/clientes/novo"
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
            >
              <Plus className="h-4 w-4" />
              Criar cliente
            </Link>
          }
        />
      ) : (
        <ClientesList clientes={rows} />
      )}
    </div>
  );
}
