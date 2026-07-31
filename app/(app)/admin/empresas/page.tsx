import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Regional } from "@/lib/types";
import { EmpresasList, type EmpresaRow } from "./empresas-list";
import { EmpresaDrawer } from "./empresa-drawer";

export const dynamic = "force-dynamic";

export default async function AdminEmpresasPage() {
  const session = await requireAdmin();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const [empRes, regRes] = await Promise.all([
    supabase
      .from("empresas")
      .select(
        "id, razao_social, nome_fantasia, cnpj, cidade, uf, principal, ativo, regional_id, " +
          "regional:regionais(id, nome)",
      )
      .eq("tenant_id", tenantId)
      .order("principal", { ascending: false })
      .order("razao_social", { ascending: true }),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("nome"),
  ]);

  if (empRes.error) console.error("[admin.empresas.list]", empRes.error.message);
  if (regRes.error) console.error("[admin.empresas.regionais]", regRes.error.message);

  const rows: EmpresaRow[] = ((empRes.data ?? []) as any[]).map((e) => ({
    id: e.id,
    razao_social: e.razao_social,
    nome_fantasia: e.nome_fantasia,
    cnpj: e.cnpj,
    cidade: e.cidade,
    uf: e.uf,
    principal: e.principal,
    ativo: e.ativo,
    regional_id: e.regional_id,
    regional_nome: e.regional?.nome ?? null,
  }));

  const regionais = (regRes.data ?? []) as Pick<Regional, "id" | "nome">[];

  return (
    <div className="space-y-8">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-california-red transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para Administração
      </Link>

      <header className="flex items-start justify-between gap-6">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
            Administração
          </p>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-california-red/10 p-2">
              <Building2 className="h-5 w-5 text-california-red" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Empresas</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Cadastre as pessoas jurídicas do grupo California. A empresa marcada
            como <b>principal</b> é usada por padrão em novos projetos.
          </p>
        </div>
        <EmpresaDrawer mode="create" regionais={regionais} />
      </header>

      <EmpresasList rows={rows} regionais={regionais} />
    </div>
  );
}
