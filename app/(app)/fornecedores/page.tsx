import Link from "next/link";
import { Building2, Plus, ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Fornecedor } from "@/lib/types";
import { EmptyState } from "@/components/empty-state";
import { FornecedoresList } from "./fornecedores-list";

export default async function FornecedoresPage() {
  const session = await requireSession();
  const supabase = createClient();

  const { data: fornecedores, error } = await supabase
    .from("fornecedores")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .order("nome", { ascending: true })
    .returns<Fornecedor[]>();

  if (error) console.error("[fornecedores.page]", error.message);
  const rows = fornecedores ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <nav className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <Link href="/cadastros" className="hover:text-california-red transition-colors">
              Cadastros
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-california-red">Fornecedores</span>
          </nav>
          <h1 className="text-3xl font-bold tracking-tight">Fornecedores</h1>
          <p className="text-sm text-muted-foreground">
            Pessoas físicas ou jurídicas que aparecem como custo nos itens
            da versão do orçamento.
          </p>
        </div>
        <Link
          href="/fornecedores/novo"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
        >
          <Plus className="h-4 w-4" />
          Novo fornecedor
        </Link>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhum fornecedor cadastrado"
          description="Cadastre fornecedores para uso nas versões de orçamento."
          action={
            <Link
              href="/fornecedores/novo"
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
            >
              <Plus className="h-4 w-4" />
              Criar fornecedor
            </Link>
          }
        />
      ) : (
        <FornecedoresList fornecedores={rows} />
      )}
    </div>
  );
}
