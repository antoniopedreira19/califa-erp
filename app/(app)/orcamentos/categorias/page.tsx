import Link from "next/link";
import { ChevronRight, Tags } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Categoria, CategoriaDominio } from "@/lib/types";
import { CategoriasTabs } from "./categorias-tabs";

export const dynamic = "force-dynamic";

export default async function CategoriasHubPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [itensRes, orcamentoRes] = await Promise.all([
    supabase
      .from("categorias")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("nome", { ascending: true })
      .returns<Categoria[]>(),
    supabase
      .from("categorias_dominio")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("escopo", { ascending: true })
      .order("nome", { ascending: true })
      .returns<CategoriaDominio[]>(),
  ]);

  if (itensRes.error) {
    console.error("[categorias-hub.itens]", itensRes.error.message);
  }
  if (orcamentoRes.error) {
    console.error("[categorias-hub.orcamento]", orcamentoRes.error.message);
  }

  const isAdmin = session.activeRole === "administrador";

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <nav className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Link href="/orcamentos" className="hover:text-foreground">
            Projetos &amp; Orçamentos
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span>Categorias</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Tags className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Categorias</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          <strong>Categorias de Item</strong> classificam cada linha da
          versão do orçamento (verbas).{" "}
          <strong>Categorias do Orçamento/Projeto</strong> classificam a
          iniciativa como um todo — projeto (Fee, Ativação...) ou orçamento
          (Cachê Artístico, Influencer...); o job herda a categoria do
          orçamento que o originou.
        </p>
      </header>

      <CategoriasTabs
        categoriasItem={itensRes.data ?? []}
        categoriasOrcamento={orcamentoRes.data ?? []}
        isAdmin={isAdmin}
      />
    </div>
  );
}
