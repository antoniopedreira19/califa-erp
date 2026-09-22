import Link from "next/link";
import { ArrowLeft, Percent } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { RateiosAdminView, type EmpresaRateios } from "./rateios-admin-view";

export const dynamic = "force-dynamic";

export default async function RateiosRegionaisPage() {
  const session = await requireAdmin();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const [empresasRes, regionaisRes, rateiosRes] = await Promise.all([
    supabase
      .from("empresas")
      .select("id, nome_fantasia")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("nome_fantasia"),
    supabase
      .from("regionais")
      .select("id, nome, empresa_id")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("empresas_rateios_regionais")
      .select("empresa_id, ano_vigencia, regional_id, percentual"),
  ]);

  const empresas = (empresasRes.data ?? []) as {
    id: string;
    nome_fantasia: string;
  }[];
  const regionais = (regionaisRes.data ?? []) as {
    id: string;
    nome: string;
    empresa_id: string;
  }[];

  // Agrupa por empresa e por ano
  const dadosPorEmpresa = new Map<string, EmpresaRateios>();
  for (const e of empresas) {
    dadosPorEmpresa.set(e.id, {
      empresa_id: e.id,
      nome_fantasia: e.nome_fantasia,
      regionais: regionais
        .filter((r) => r.empresa_id === e.id)
        .map((r) => ({ id: r.id, nome: r.nome }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
      rateioPorAno: {},
    });
  }
  for (const l of ((rateiosRes.data ?? []) as any[])) {
    const alvo = dadosPorEmpresa.get(l.empresa_id);
    if (!alvo) continue;
    const ano = l.ano_vigencia as number;
    if (!alvo.rateioPorAno[ano]) alvo.rateioPorAno[ano] = {};
    alvo.rateioPorAno[ano][l.regional_id] = Number(l.percentual);
  }

  const empresasFinais = Array.from(dadosPorEmpresa.values());

  // Anos disponíveis (todos os anos que aparecem em qualquer empresa) +
  // ano corrente + próximos 3 anos, deduplicados e ordenados desc.
  const anosPresentes = new Set<number>();
  for (const l of ((rateiosRes.data ?? []) as any[])) {
    anosPresentes.add(l.ano_vigencia);
  }
  const anoAtual = new Date().getFullYear();
  for (let a = anoAtual; a <= anoAtual + 3; a += 1) anosPresentes.add(a);
  const anosDisponiveis = Array.from(anosPresentes).sort((a, b) => b - a);

  return (
    <div className="space-y-6">
      <Link
        href="/admin"
        prefetch={false}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3 w-3" />
        Voltar para Administração
      </Link>

      <PageHeader
        eyebrow="ADMINISTRAÇÃO"
        title="Rateios regionais"
        description="Percentual de distribuição do custo de colaboradores marcados como 'Todas as regionais' entre as regionais da empresa. Fonte-verdade única, editada 1×/ano. Regionais fora da lista têm 0% no ano."
        icon={Percent}
      />

      <RateiosAdminView
        empresas={empresasFinais}
        anosDisponiveis={anosDisponiveis}
        anoInicial={anoAtual}
      />
    </div>
  );
}
