import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import { listEmpresasAtivas, getEmpresaPrincipal } from "@/lib/data/empresas";
import type { CategoriaDominio, Cliente, Regional } from "@/lib/types";
import { ProjetoForm, type ProdutoOption } from "../projeto-form";

export const dynamic = "force-dynamic";

export default async function NovoProjetoPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [clientesRes, responsaveis, regionaisRes, produtosRes, categoriasRes, empresas, principal] = await Promise.all([
    supabase
      .from("clientes")
      .select("id, nome_fantasia, codigo_curto")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    listActiveMembers(session.activeTenant.id),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    // Cadastro pequeno (por cliente): vem inteiro e o formulário filtra
    // pelo cliente escolhido, sem ida extra ao servidor a cada troca.
    supabase
      .from("cliente_produtos")
      .select("id, nome, codigo, cliente_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("codigo"),
    supabase
      .from("categorias_dominio")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo", "projeto")
      .eq("ativo", true)
      .order("nome"),
    listEmpresasAtivas(session.activeTenant.id),
    getEmpresaPrincipal(session.activeTenant.id),
  ]);

  const clientes = (clientesRes.data ?? []) as Pick<
    Cliente,
    "id" | "nome_fantasia" | "codigo_curto"
  >[];
  const regionais = (regionaisRes.data ?? []) as Pick<Regional, "id" | "nome">[];
  const produtos = (produtosRes.data ?? []) as ProdutoOption[];
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
          empresas={empresas}
          empresaPrincipalId={principal?.id}
          clientes={clientes}
          responsaveis={responsaveis}
          regionais={regionais}
          produtos={produtos}
          categorias={categorias}
          criadorId={session.profile.id}
        />
      </div>
    </div>
  );
}
