import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import type { Cliente, Orcamento } from "@/lib/types";
import { EmptyState } from "@/components/empty-state";
import { OrcamentosList, type OrcamentoRow } from "./orcamentos-list";


export default async function OrcamentosPage() {
  const session = await requireSession();
  const supabase = createClient();

  // Busca em paralelo: orçamentos (com embed em clientes e profiles do
  // responsável, os dois têm FK direta em orcamentos), clientes ativos
  // para o filtro e membros ativos do tenant para o filtro de responsável.
  const [orcRes, clientesRes, responsaveis] = await Promise.all([
    supabase
      .from("orcamentos")
      .select(
        "id, codigo, nome, status, cliente_id, responsavel_id, tipo, campanha, data_inicio_prevista, data_fim_prevista, created_at, cliente:clientes(id, nome_fantasia), responsavel:profiles!responsavel_id(id, nome)",
      )
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("clientes")
      .select("id, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    listActiveMembers(session.activeTenant.id),
  ]);

  if (orcRes.error) console.error("[orcamentos.page]", orcRes.error.message);
  if (clientesRes.error) console.error("[orcamentos.clientes]", clientesRes.error.message);

  const orcamentos: OrcamentoRow[] = ((orcRes.data ?? []) as any[]).map((o) => ({
    id: o.id,
    codigo: o.codigo,
    nome: o.nome,
    status: o.status as Orcamento["status"],
    cliente_id: o.cliente_id,
    responsavel_id: o.responsavel_id,
    tipo: o.tipo,
    campanha: o.campanha,
    data_inicio_prevista: o.data_inicio_prevista,
    data_fim_prevista: o.data_fim_prevista,
    created_at: o.created_at,
    cliente_nome: o.cliente?.nome_fantasia ?? null,
    responsavel_nome: o.responsavel?.nome ?? null,
  }));

  const clientes = (clientesRes.data ?? []) as Pick<Cliente, "id" | "nome_fantasia">[];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
            Comercial
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Orçamentos</h1>
          <p className="text-sm text-muted-foreground">
            Oportunidades comerciais em preparação. Cada orçamento vira job
            quando uma versão for aprovada (fluxo completo nas próximas tasks).
          </p>
        </div>
        <Link
          href="/orcamentos/novo"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
        >
          <Plus className="h-4 w-4" />
          Novo orçamento
        </Link>
      </header>

      {orcamentos.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nenhum orçamento criado"
          description="Crie um orçamento para acompanhar a oportunidade comercial até virar job."
          action={
            <Link
              href="/orcamentos/novo"
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
            >
              <Plus className="h-4 w-4" />
              Criar orçamento
            </Link>
          }
        />
      ) : (
        <OrcamentosList
          orcamentos={orcamentos}
          clientes={clientes}
          responsaveis={responsaveis}
        />
      )}
    </div>
  );
}
