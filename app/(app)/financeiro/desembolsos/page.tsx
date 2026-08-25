import { ChevronRight, Wallet } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DesembolsosList, type DesembolsoRow } from "./desembolsos-list";

export const dynamic = "force-dynamic";

export default async function DesembolsosPage() {
  const session = await requireSession();
  const supabase = createClient();
  const isAdminOrFinanceiro =
    session.activeRole === "administrador" || session.activeRole === "financeiro";

  // Base query — user comum vê só os seus
  // forma_pagamento e cartao_credito_id ainda existem no banco (Task 7 remove);
  // mantemos no SELECT para exibição de registros antigos na lista
  let query = supabase
    .from("desembolsos")
    .select(`
      id, codigo, descricao, valor, status, forma_pagamento, cartao_credito_id,
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
      .select("id, nome, razao_social")
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
      .select("id, nome, ativo")
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
  }));

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link
            href="/financeiro"
            prefetch={false}
            className="hover:text-california-red transition-colors"
          >
            Financeiro
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">Desembolsos</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Wallet className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Desembolsos</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl text-pretty">
          Lance suas despesas e acompanhe o status. Ao ser aprovado pelo
          financeiro, o desembolso vira título a pagar.
        </p>
      </header>

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
