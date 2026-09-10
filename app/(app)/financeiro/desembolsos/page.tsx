import { Wallet } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { DesembolsosList, type DesembolsoRow } from "./desembolsos-list";

export const dynamic = "force-dynamic";

export default async function DesembolsosPage({
  searchParams,
}: {
  searchParams?: { filtro?: string; empresa?: string };
}) {
  const session = await requireSession();
  const supabase = createClient();
  const isAdminOrFinanceiro =
    session.activeRole === "administrador" || session.activeRole === "financeiro";

  const empresaFiltroIds: string[] =
    typeof searchParams?.empresa === "string" && searchParams.empresa.length > 0
      ? searchParams.empresa.split(",").filter((id) => id.length > 0)
      : session.activeEmpresas.map((e) => e.id);

  const activeEmpresasEfetivas =
    empresaFiltroIds.length > 0
      ? session.empresas.filter((e) => empresaFiltroIds.includes(e.id))
      : [];

  // Base query — user comum vê só os seus
  let query = supabase
    .from("desembolsos")
    .select(`
      id, codigo, descricao, valor, status,
      data_prevista_pagamento, criado_por, created_at,
      empresa:empresas(id, razao_social, nome_fantasia),
      fornecedor:fornecedores(id, nome, razao_social),
      criador:profiles!desembolsos_criado_por_fkey(nome)
    `)
    .eq("tenant_id", session.activeTenant.id)
    .order("created_at", { ascending: false });

  if (!isAdminOrFinanceiro) {
    query = query.eq("criado_por", session.profile.id);
  }

  // Filtro de aterrissagem da home
  if (searchParams?.filtro === "avaliacao") {
    query = query.eq("status", "em_avaliacao");
  }

  if (empresaFiltroIds.length > 0) {
    query = query.in("empresa_id", empresaFiltroIds);
  }

  const [
    desembolsosRes,
    empresasRes,
    fornecedoresRes,
    clientesRes,
    jobsRes,
    regionaisRes,
  ] = await Promise.all([
    query,
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("razao_social"),
    supabase
      .from("fornecedores")
      // `cpf_cnpj` desde 10/09/2026: o campo de fornecedor busca por ele
      // e o mostra como segunda linha da opção (decisão 067).
      .select("id, nome, razao_social, cpf_cnpj")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome"),
    supabase
      .from("clientes")
      .select("id, nome_fantasia, razao_social")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    supabase
      .from("jobs")
      .select("id, codigo, nome")
      .eq("tenant_id", session.activeTenant.id)
      .neq("status", "cancelado")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("regionais")
      .select("id, nome, ativo, empresa_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
  ]);

  if (desembolsosRes.error) {
    console.error("[desembolsos.list]", desembolsosRes.error.message);
  }

  const empresasList = (empresasRes.data ?? []).map((e) => ({
    id: e.id,
    nome: e.razao_social ?? e.nome_fantasia ?? "",
  }));

  const fornecedoresList = (fornecedoresRes.data ?? []).map((f) => ({
    id: f.id,
    nome: f.razao_social ?? f.nome,
    cpf_cnpj: f.cpf_cnpj,
  }));

  const clientesList = (clientesRes.data ?? []).map((c) => ({
    id: c.id,
    nome: c.razao_social ?? c.nome_fantasia ?? "",
  }));

  const jobsList = (jobsRes.data ?? []).map((j) => ({
    id: j.id,
    codigo: j.codigo,
    nome: j.nome,
  }));

  const regionaisList = (regionaisRes.data ?? []).map((r) => ({
    id: r.id,
    nome: r.nome,
    ativo: r.ativo,
    empresa_id: r.empresa_id,
  }));

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <PageHeader
        eyebrow="FINANCEIRO"
        title="Desembolsos"
        description="Lance suas despesas e acompanhe o status. Ao ser aprovado pelo financeiro, o desembolso vira título a pagar."
        icon={Wallet}
        showEmpresaFilter
        empresas={session.empresasVisiveis}
        activeEmpresas={activeEmpresasEfetivas}
      />

      <DesembolsosList
        rows={(desembolsosRes.data ?? []) as unknown as DesembolsoRow[]}
        tenantId={session.activeTenant.id}
        empresas={empresasList}
        fornecedores={fornecedoresList}
        clientes={clientesList}
        jobs={jobsList}
        regionais={regionaisList}
        isAdminOrFinanceiro={isAdminOrFinanceiro}
      />
    </div>
  );
}
