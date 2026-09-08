import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Regional } from "@/lib/types";
import { EmpresaCard } from "./empresa-card";
import { EmpresaDrawer } from "./empresa-drawer";
import type { EmpresaRow } from "./types";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function AdminEmpresasPage() {
  const session = await requireAdmin();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const [empRes, regRes] = await Promise.all([
    supabase
      .from("empresas")
      .select(
        "id, razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, " +
          "cep, logradouro, numero, complemento, bairro, cidade, uf, telefone, email, " +
          "local_pagamento, instrucoes_nf, principal, ativo",
      )
      .eq("tenant_id", tenantId)
      .order("principal", { ascending: false })
      .order("razao_social", { ascending: true }),
    supabase
      .from("regionais")
      .select(
        "id, tenant_id, empresa_id, nome, ativo, created_by, created_at, updated_at",
      )
      .eq("tenant_id", tenantId)
      .order("ativo", { ascending: false })
      .order("nome", { ascending: true }),
  ]);

  if (empRes.error) console.error("[admin.empresas.list]", empRes.error.message);
  if (regRes.error) console.error("[admin.regionais.list]", regRes.error.message);

  const empresas: EmpresaRow[] = ((empRes.data ?? []) as any[]).map((e) => ({
    id: e.id,
    razao_social: e.razao_social,
    nome_fantasia: e.nome_fantasia,
    cnpj: e.cnpj,
    inscricao_estadual: e.inscricao_estadual,
    inscricao_municipal: e.inscricao_municipal,
    cep: e.cep,
    logradouro: e.logradouro,
    numero: e.numero,
    complemento: e.complemento,
    bairro: e.bairro,
    cidade: e.cidade,
    uf: e.uf,
    telefone: e.telefone,
    email: e.email,
    local_pagamento: e.local_pagamento,
    instrucoes_nf: e.instrucoes_nf,
    principal: e.principal,
    ativo: e.ativo,
  }));

  const regionaisPorEmpresa = new Map<string, Regional[]>();
  for (const r of (regRes.data ?? []) as Regional[]) {
    const arr = regionaisPorEmpresa.get(r.empresa_id) ?? [];
    arr.push(r);
    regionaisPorEmpresa.set(r.empresa_id, arr);
  }

  return (
    <div className="space-y-8">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-california-red transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para Administração
      </Link>

      <PageHeader
        eyebrow="ADMINISTRAÇÃO"
        title="Empresas & regionais"
        description="Organograma do grupo California: empresas do tenant e as regionais que operam sob cada uma. A empresa marcada como principal é usada por padrão em novos projetos."
        icon={Building2}
        actions={<EmpresaDrawer mode="create" />}
      />

      {empresas.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-sm text-muted-foreground shadow-soft">
          Nenhuma empresa cadastrada ainda. Use{" "}
          <span className="font-medium">+ Nova empresa</span> pra começar.
        </div>
      ) : (
        <div className="space-y-4">
          {empresas.map((empresa) => (
            <EmpresaCard
              key={empresa.id}
              empresa={empresa}
              regionais={regionaisPorEmpresa.get(empresa.id) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
