import Link from "next/link";
import { Users, Building2, Tag, Layers, MapPin, ArrowRight, type LucideIcon } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CadastrosPage() {
  const session = await requireSession();
  const supabase = createClient();

  // Contagens de ativos em paralelo para cada cadastro do hub.
  const [clientesRes, fornecedoresRes, categoriasRes, catDominioRes, regionaisRes] = await Promise.all([
    supabase
      .from("clientes")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo"),
    supabase
      .from("fornecedores")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo"),
    supabase
      .from("categorias")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    supabase
      .from("categorias_dominio")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    supabase
      .from("regionais")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
  ]);

  if (clientesRes.error) console.error("[cadastros.clientes]", clientesRes.error.message);
  if (fornecedoresRes.error) console.error("[cadastros.fornecedores]", fornecedoresRes.error.message);
  if (categoriasRes.error) console.error("[cadastros.categorias]", categoriasRes.error.message);
  if (catDominioRes.error) console.error("[cadastros.categorias_dominio]", catDominioRes.error.message);
  if (regionaisRes.error) console.error("[cadastros.regionais]", regionaisRes.error.message);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Cadastros
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Cadastros da empresa</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Ponto central para gerenciar as entidades do negócio. Novos tipos de
          cadastro aparecem aqui à medida que os módulos vão sendo liberados.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <CadastroCard
          href="/clientes"
          icon={Users}
          title="Clientes"
          description="Empresas contratantes para as quais a agência produz orçamentos."
          count={clientesRes.count ?? 0}
        />
        <CadastroCard
          href="/fornecedores"
          icon={Building2}
          title="Fornecedores"
          description="Pessoas físicas ou jurídicas que aparecem como custo nos itens da versão do orçamento."
          count={fornecedoresRes.count ?? 0}
        />
        <CadastroCard
          href="/categorias"
          icon={Tag}
          title="Categorias"
          description="Vocabulário compartilhado para classificar itens de orçamento."
          count={categoriasRes.count ?? 0}
        />
        <CadastroCard
          href="/cadastros/categorias-dominio"
          icon={Layers}
          title="Categorias (Projeto/Orçamento)"
          description="Tipo de iniciativa para classificar projetos (Fee, Evento...) e orçamentos (Always On, Mídia...)."
          count={catDominioRes.count ?? 0}
        />
        <CadastroCard
          href="/cadastros/regionais"
          icon={MapPin}
          title="Regionais"
          description="Vocabulário usado ao criar jobs — ex.: SP, Nordeste, Rio de Janeiro."
          count={regionaisRes.count ?? 0}
        />
      </div>
    </div>
  );
}

function CadastroCard({
  href,
  icon: Icon,
  title,
  description,
  count,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col rounded-2xl border border-border bg-card p-6 shadow-soft transition-all hover:border-california-red/30 hover:shadow-elevated"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
        <Icon className="h-5 w-5" />
      </div>

      <h3 className="mt-4 text-lg font-semibold text-foreground group-hover:text-california-red transition-colors">
        {title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{count}</span>{" "}
          {count === 1 ? "ativo" : "ativos"}
        </p>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
          Abrir
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
