import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import { listarCidadesIniciais } from "@/lib/data/cidades";
import type { CategoriaDominio, Profile, Regional } from "@/lib/types";
import { OrcamentoForm } from "../orcamento-form";

export const dynamic = "force-dynamic";

export default async function NovoOrcamentoPage({
  params,
}: {
  params: { projetoId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const [{ data: projeto }, categoriasRes, regionaisRes, respRes, cidadesIniciais, produtores] =
    await Promise.all([
      supabase
        .from("projetos")
        .select("id, codigo, nome")
        .eq("id", params.projetoId)
        .eq("tenant_id", session.activeTenant.id)
        .maybeSingle(),
      supabase
        .from("categorias_dominio")
        .select("id, nome")
        .eq("tenant_id", session.activeTenant.id)
        .eq("escopo", "orcamento")
        .eq("ativo", true)
        .order("nome"),
      // Regional e GP do orçamento saem do que foi cadastrado no projeto.
      supabase
        .from("projeto_regionais")
        .select("regional:regionais(id, nome)")
        .eq("projeto_id", params.projetoId)
        .eq("tenant_id", session.activeTenant.id),
      supabase
        .from("projeto_responsaveis")
        .select("profile:profiles(id, nome)")
        .eq("projeto_id", params.projetoId)
        .eq("tenant_id", session.activeTenant.id),
      // Só as primeiras cidades: o combobox busca o resto no servidor a
      // cada digitação. O cadastro comporta o Brasil inteiro.
      listarCidadesIniciais(session.activeTenant.id),
      listActiveMembers(session.activeTenant.id),
    ]);

  if (!projeto) notFound();

  const categorias = (categoriasRes.data ?? []) as Pick<CategoriaDominio, "id" | "nome">[];

  const regionaisDoProjeto = ((regionaisRes.data ?? []) as any[])
    .filter((v) => v.regional)
    .map((v) => ({ id: v.regional.id, nome: v.regional.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) as Pick<Regional, "id" | "nome">[];

  const gpsDoProjeto = ((respRes.data ?? []) as any[])
    .filter((v) => v.profile)
    .map((v) => ({ id: v.profile.id, nome: v.profile.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) as Pick<Profile, "id" | "nome">[];

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Link
          href={`/orcamentos/${params.projetoId}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para {projeto.codigo} · {projeto.nome}
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Novo orçamento</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O código será gerado no formato{" "}
          <span className="font-mono">{projeto.codigo}-NN</span>.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <OrcamentoForm
          projetoId={params.projetoId}
          categorias={categorias}
          regionaisDoProjeto={regionaisDoProjeto}
          cidadesIniciais={cidadesIniciais}
          gpsDoProjeto={gpsDoProjeto}
          produtores={produtores}
        />
      </div>
    </div>
  );
}
