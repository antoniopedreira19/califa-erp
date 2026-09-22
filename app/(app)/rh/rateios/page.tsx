import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Percent } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { RateiosView, type EmpresaRateio } from "./rateios-view";

export const dynamic = "force-dynamic";

export default async function RateiosPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

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
      .select("empresa_id, ano_vigencia, regional_id, percentual")
      .eq("tenant_id", tenantId)
      .order("ano_vigencia", { ascending: false }),
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

  // Agrupa rateios em { empresa_id → ano → linhas[] }
  const rateiosPorEmpresa = new Map<string, EmpresaRateio>();
  for (const e of empresas) {
    rateiosPorEmpresa.set(e.id, {
      empresa_id: e.id,
      nome_fantasia: e.nome_fantasia,
      regionais: regionais
        .filter((r) => r.empresa_id === e.id)
        .map((r) => ({ id: r.id, nome: r.nome })),
      anos: [],
    });
  }
  const bucketPorAno = new Map<string, Map<number, Map<string, number>>>();
  for (const l of ((rateiosRes.data ?? []) as any[])) {
    let porAno = bucketPorAno.get(l.empresa_id);
    if (!porAno) {
      porAno = new Map<number, Map<string, number>>();
      bucketPorAno.set(l.empresa_id, porAno);
    }
    let porRegional = porAno.get(l.ano_vigencia);
    if (!porRegional) {
      porRegional = new Map<string, number>();
      porAno.set(l.ano_vigencia, porRegional);
    }
    porRegional.set(l.regional_id, Number(l.percentual));
  }
  for (const [empresaId, porAno] of bucketPorAno) {
    const alvo = rateiosPorEmpresa.get(empresaId);
    if (!alvo) continue;
    const anos = Array.from(porAno.entries()).map(([ano, porRegional]) => ({
      ano,
      linhas: Array.from(porRegional.entries()).map(([regional_id, percentual]) => ({
        regional_id,
        percentual,
      })),
    }));
    anos.sort((a, b) => b.ano - a.ano);
    alvo.anos = anos;
  }

  const empresasFinais = Array.from(rateiosPorEmpresa.values());

  return (
    <div className="space-y-6">
      <Link
        href="/rh"
        prefetch={false}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3 w-3" />
        Voltar para RH
      </Link>

      <PageHeader
        eyebrow="RH"
        title="Rateios anuais por regional"
        description="Percentual de distribuição do custo de colaboradores marcados como 'Todas as regionais' entre as regionais da empresa. Fonte-verdade única, editada 1×/ano. Regionais com 0% não entram."
        icon={Percent}
      />

      <RateiosView empresas={empresasFinais} />
    </div>
  );
}
