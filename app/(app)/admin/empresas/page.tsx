import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Regional } from "@/lib/types";
import { EmpresaCard } from "./empresa-card";
import { EmpresaDrawer } from "./empresa-drawer";
import type { EmpresaRow } from "./types";
import type { UsuarioAcesso } from "./usuarios-modal";
import { PageHeader } from "@/components/ui/page-header";
import { EmpresasTabs } from "./tabs";
import { EmpresaContabilCard } from "./contabeis/empresa-contabil-card";
import { EmpresaContabilDrawer } from "./contabeis/empresa-contabil-drawer";
import type { EmpresaContabilRow } from "./contabeis/types";

export const dynamic = "force-dynamic";

export default async function AdminEmpresasPage() {
  const session = await requireAdmin();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const service = createServiceClient();

  const [empRes, regRes, memRes, contabeisRes] = await Promise.all([
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
    // Fase 2B: pega empresa_members ativos deste tenant pra montar o
    // resumo "N usuarios com acesso" nos cards das empresas. Service client
    // evita depender da RLS (que restringe por empresa) — admin ve tudo.
    service
      .from("empresa_members")
      .select("empresa_id, user_id, regional_id")
      .eq("tenant_id", tenantId)
      .eq("status", "ativo"),
    supabase
      .from("empresas_contabeis")
      .select("id, razao_social, nome_fantasia, cnpj, ativo")
      .eq("tenant_id", tenantId)
      .order("ativo", { ascending: false })
      .order("razao_social", { ascending: true }),
  ]);

  if (empRes.error) console.error("[admin.empresas.list]", empRes.error.message);
  if (regRes.error) console.error("[admin.regionais.list]", regRes.error.message);
  if (memRes.error)
    console.error("[admin.empresas.list.members]", memRes.error.message);
  if (contabeisRes.error)
    console.error("[admin.empresas_contabeis.list]", contabeisRes.error.message);

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

  const empresasContabeis: EmpresaContabilRow[] = (
    (contabeisRes.data ?? []) as any[]
  ).map((e) => ({
    id: e.id,
    razao_social: e.razao_social,
    nome_fantasia: e.nome_fantasia,
    cnpj: e.cnpj,
    ativo: e.ativo,
  }));

  const regionaisPorEmpresa = new Map<string, Regional[]>();
  for (const r of (regRes.data ?? []) as Regional[]) {
    const arr = regionaisPorEmpresa.get(r.empresa_id) ?? [];
    arr.push(r);
    regionaisPorEmpresa.set(r.empresa_id, arr);
  }

  // Agrega empresa_members em {empresa_id -> user_id -> {escopo, regional_ids}}.
  // - regional_id NULL = escopo "todas"
  // - regional_id preenchido = escopo "restrito" com essas regionais
  // - misto (uma linha NULL + linhas de regional) = manda "todas" (regra: NULL vence)
  type Agregado = { escopo: "todas" | "restrito"; regionalIds: Set<string> };
  const acessoPorEmpresaEUser = new Map<
    string,
    Map<string, Agregado>
  >();
  const userIdsSet = new Set<string>();

  for (const m of memRes.data ?? []) {
    const empresaId = m.empresa_id as string;
    const userId = m.user_id as string;
    const regionalId = m.regional_id as string | null;
    userIdsSet.add(userId);

    let porUser = acessoPorEmpresaEUser.get(empresaId);
    if (!porUser) {
      porUser = new Map();
      acessoPorEmpresaEUser.set(empresaId, porUser);
    }
    let agg = porUser.get(userId);
    if (!agg) {
      agg = { escopo: "restrito", regionalIds: new Set() };
      porUser.set(userId, agg);
    }
    if (regionalId === null) {
      agg.escopo = "todas";
      agg.regionalIds.clear();
    } else if (agg.escopo !== "todas") {
      agg.regionalIds.add(regionalId);
    }
  }

  // Fetch de profiles pra montar nome/email dos users com acesso.
  const userIds = Array.from(userIdsSet);
  const { data: profs } = userIds.length
    ? await service
        .from("profiles")
        .select("id, nome, email")
        .in("id", userIds)
    : { data: [] as Array<{ id: string; nome: string; email: string }> };
  const profileById = new Map(
    (profs ?? []).map((p) => [
      p.id as string,
      { nome: p.nome as string, email: p.email as string },
    ]),
  );

  // Mapa regional_id -> nome pra renderizar no modal
  const regionalNomeById = new Map<string, string>();
  for (const r of (regRes.data ?? []) as Regional[]) {
    regionalNomeById.set(r.id, r.nome);
  }

  const usuariosAcessoPorEmpresa = new Map<string, UsuarioAcesso[]>();
  for (const [empresaId, porUser] of acessoPorEmpresaEUser.entries()) {
    const lista: UsuarioAcesso[] = [];
    for (const [userId, agg] of porUser.entries()) {
      const prof = profileById.get(userId);
      lista.push({
        user_id: userId,
        nome: prof?.nome ?? "—",
        email: prof?.email ?? "—",
        escopo: agg.escopo,
        regionais:
          agg.escopo === "todas"
            ? []
            : Array.from(agg.regionalIds)
                .map((id) => regionalNomeById.get(id) ?? "—")
                .sort(),
      });
    }
    lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    usuariosAcessoPorEmpresa.set(empresaId, lista);
  }

  // --- Conteúdo da aba "Gerenciais" ---
  const conteudoGerenciais =
    empresas.length === 0 ? (
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
            usuariosAcesso={usuariosAcessoPorEmpresa.get(empresa.id) ?? []}
          />
        ))}
      </div>
    );

  // --- Conteúdo da aba "Contábeis" ---
  const conteudoContabeis = (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <EmpresaContabilDrawer mode="criar" />
      </div>
      {empresasContabeis.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center text-sm text-muted-foreground shadow-soft">
          Nenhuma empresa contábil cadastrada ainda. Use{" "}
          <span className="font-medium">+ Nova empresa contábil</span> pra
          começar.
        </div>
      ) : (
        <div className="space-y-4">
          {empresasContabeis.map((ec) => (
            <EmpresaContabilCard key={ec.id} empresa={ec} />
          ))}
        </div>
      )}
    </div>
  );

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

      <EmpresasTabs
        empresasGerenciais={conteudoGerenciais}
        empresasContabeis={conteudoContabeis}
      />
    </div>
  );
}
