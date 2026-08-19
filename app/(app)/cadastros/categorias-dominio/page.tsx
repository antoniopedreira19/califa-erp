import Link from "next/link";
import { ChevronRight, Layers } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { CategoriaDominio } from "@/lib/types";
import { CategoriasDominioList } from "./categorias-dominio-list";

export const dynamic = "force-dynamic";

export default async function CategoriasDominioPage() {
  const session = await requireSession();
  const supabase = createClient();

  const { data, error } = await supabase
    .from("categorias_dominio")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .order("escopo", { ascending: true })
    .order("nome", { ascending: true })
    .returns<CategoriaDominio[]>();

  if (error) {
    console.error("[categorias_dominio.page]", error.message);
  }

  const rows = data ?? [];
  const isAdmin = session.activeRole === "administrador";

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <nav className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Link href="/cadastros" className="hover:text-foreground">
            Cadastros
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span>Categorias (Projeto/Orçamento)</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Layers className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Categorias (Projeto/Orçamento)
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Vocabulário para classificar projetos (Fee, Evento, Campanha...) e
          orçamentos (Always On, Mídia, Influencer...) por tipo de iniciativa.
          O job não tem categoria própria: herda a do orçamento que o
          originou, e o financeiro pode trocá-la na abertura.
        </p>
      </header>

      <CategoriasDominioList categorias={rows} isAdmin={isAdmin} />
    </div>
  );
}
