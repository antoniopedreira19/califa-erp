import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EmpresasList, type EmpresaRow } from "./empresas-list";
import { EmpresaDrawer } from "./empresa-drawer";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function AdminEmpresasPage() {
  const session = await requireAdmin();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const empRes = await supabase
    .from("empresas")
    .select(
      "id, razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, " +
        "cep, logradouro, numero, complemento, bairro, cidade, uf, telefone, email, " +
        "local_pagamento, instrucoes_nf, principal, ativo",
    )
    .eq("tenant_id", tenantId)
    .order("principal", { ascending: false })
    .order("razao_social", { ascending: true });

  if (empRes.error) console.error("[admin.empresas.list]", empRes.error.message);

  const rows: EmpresaRow[] = ((empRes.data ?? []) as any[]).map((e) => ({
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
        title="Empresas"
        description="Cadastre as pessoas jurídicas do grupo California. A empresa marcada como principal é usada por padrão em novos projetos."
        icon={Building2}
        actions={<EmpresaDrawer mode="create" />}
      />

      <EmpresasList rows={rows} />
    </div>
  );
}
