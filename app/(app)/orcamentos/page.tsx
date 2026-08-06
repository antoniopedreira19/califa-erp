import Link from "next/link";
import { FolderKanban, Plus, FileText } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Cliente, Projeto } from "@/lib/types";
import { EmptyState } from "@/components/empty-state";
import { ProjetosList, type ProjetoRow } from "./projetos-list";

export const dynamic = "force-dynamic";

export default async function ProjetosPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [projRes, clientesRes] = await Promise.all([
    supabase
      .from("projetos")
      .select(
        "id, codigo, nome, campanha, status, cliente_id, produto_id, " +
          "data_inicio_prevista, created_at, " +
          "cliente:clientes(id, nome_fantasia), " +
          "produto:cliente_produtos(id, nome), " +
          "categoria:categorias_dominio(nome)",
      )
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("clientes")
      .select("id, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
  ]);

  if (projRes.error) console.error("[projetos.page]", projRes.error.message);
  if (clientesRes.error) console.error("[projetos.clientes]", clientesRes.error.message);

  const projetosBrutos = ((projRes.data ?? []) as any[]);
  const projetoIds = projetosBrutos.map((p) => p.id);

  // Contagens agregadas de orçamentos por projeto (SEM embed pesado).
  // Uma query só, split em 3 métricas por status:
  //   total = todos os orçamentos
  //   aprovados = status ∈ (aprovado, job_criado)   ← "já foi aceito pelo cliente"
  //   jobs = status = job_criado                     ← "operação abriu"
  const orcamentosCountMap = new Map<string, number>();
  const aprovadosCountMap = new Map<string, number>();
  const jobsCountMap = new Map<string, number>();
  // Regionais do projeto: N:N, então vêm numa query própria em vez de
  // embed na listagem (o embed devolveria a linha do projeto repetida).
  const regionaisMap = new Map<string, { id: string; nome: string }[]>();

  if (projetoIds.length > 0) {
    const [orcsRes, vinculosRes] = await Promise.all([
      supabase
        .from("orcamentos")
        .select("projeto_id, status")
        .in("projeto_id", projetoIds)
        .eq("tenant_id", session.activeTenant.id),
      supabase
        .from("projeto_regionais")
        .select("projeto_id, regional:regionais(id, nome)")
        .in("projeto_id", projetoIds)
        .eq("tenant_id", session.activeTenant.id),
    ]);

    for (const o of ((orcsRes.data ?? []) as any[])) {
      orcamentosCountMap.set(o.projeto_id, (orcamentosCountMap.get(o.projeto_id) ?? 0) + 1);
      if (o.status === "aprovado" || o.status === "job_criado") {
        aprovadosCountMap.set(o.projeto_id, (aprovadosCountMap.get(o.projeto_id) ?? 0) + 1);
      }
      if (o.status === "job_criado") {
        jobsCountMap.set(o.projeto_id, (jobsCountMap.get(o.projeto_id) ?? 0) + 1);
      }
    }

    for (const v of ((vinculosRes.data ?? []) as any[])) {
      if (!v.regional) continue;
      const atuais = regionaisMap.get(v.projeto_id) ?? [];
      atuais.push({ id: v.regional.id, nome: v.regional.nome });
      regionaisMap.set(v.projeto_id, atuais);
    }
    for (const lista of regionaisMap.values()) {
      lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    }
  }

  const projetos: ProjetoRow[] = projetosBrutos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nome: p.nome,
    campanha: p.campanha,
    categoria_nome: p.categoria?.nome ?? null,
    status: p.status as Projeto["status"],
    cliente_id: p.cliente_id,
    cliente_nome: p.cliente?.nome_fantasia ?? null,
    produto_id: p.produto_id,
    produto_nome: p.produto?.nome ?? null,
    regionais: regionaisMap.get(p.id) ?? [],
    data_inicio_prevista: p.data_inicio_prevista,
    orcamentos_count: orcamentosCountMap.get(p.id) ?? 0,
    aprovados_count: aprovadosCountMap.get(p.id) ?? 0,
    jobs_count: jobsCountMap.get(p.id) ?? 0,
    created_at: p.created_at,
  }));

  const clientes = (clientesRes.data ?? []) as Pick<Cliente, "id" | "nome_fantasia">[];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
            Comercial
          </p>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-california-red/10 p-2">
              <FileText className="h-5 w-5 text-california-red" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Projetos &amp; Orçamentos</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Cada projeto agrupa os orçamentos de uma iniciativa do cliente.
            Clique num projeto para ver seus orçamentos e versões.
          </p>
        </div>
        <Link
          href="/orcamentos/novo"
          prefetch={false}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
        >
          <Plus className="h-4 w-4" />
          Novo projeto
        </Link>
      </header>

      {projetos.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="Nenhum projeto ainda"
          description="Crie um projeto para começar a organizar seus orçamentos por iniciativa."
          action={
            <Link
              href="/orcamentos/novo"
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
            >
              <Plus className="h-4 w-4" />
              Criar projeto
            </Link>
          }
        />
      ) : (
        <ProjetosList projetos={projetos} clientes={clientes} />
      )}
    </div>
  );
}
