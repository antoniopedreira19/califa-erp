import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { CategoriaDominio, Cidade, Cliente, Regional } from "@/lib/types";
import { ProjetoForm } from "../projeto-form";

export const dynamic = "force-dynamic";

export default async function NovoProjetoPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [clientesRes, regionaisRes, cidadesRes, categoriasRes] = await Promise.all([
    supabase
      .from("clientes")
      .select("id, nome_fantasia, codigo_curto")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("cidades")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("categorias_dominio")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo", "projeto")
      .eq("ativo", true)
      .order("nome"),
  ]);

  const clientes = (clientesRes.data ?? []) as Pick<
    Cliente,
    "id" | "nome_fantasia" | "codigo_curto"
  >[];
  const regionais = (regionaisRes.data ?? []) as Pick<Regional, "id" | "nome">[];
  const cidades = (cidadesRes.data ?? []) as Pick<Cidade, "id" | "nome">[];
  const categorias = (categoriasRes.data ?? []) as Pick<
    CategoriaDominio,
    "id" | "nome"
  >[];

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Link
          href="/orcamentos"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para projetos
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Novo projeto</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O código do projeto é gerado automaticamente no formato{" "}
          <span className="font-mono">CLI-NNNN/AA</span>.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <ProjetoForm
          clientes={clientes}
          regionais={regionais}
          cidades={cidades}
          categorias={categorias}
        />
      </div>
    </div>
  );
}
