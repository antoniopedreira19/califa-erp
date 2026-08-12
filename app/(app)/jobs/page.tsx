import { Briefcase } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listEmpresasAtivas } from "@/lib/data/empresas";
import { JobsList, type JobRow } from "./jobs-list";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [jobsRes, empresas] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, codigo, nome, status, valor_total, faturamento_previsto, data_inicio_prevista, empresa_id, projeto_id, " +
          "projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia)), " +
          "responsavel:profiles!responsavel_id(nome), " +
          "empresa:empresas(id, razao_social, nome_fantasia)",
      )
      .eq("tenant_id", session.activeTenant.id)
      .order("codigo", { ascending: true }),
    listEmpresasAtivas(session.activeTenant.id),
  ]);

  if (jobsRes.error) console.error("[jobs.list]", jobsRes.error.message);

  const rows: JobRow[] = (jobsRes.data ?? []).map((r: any) => ({
    id: r.id,
    codigo: r.codigo,
    nome: r.nome,
    status: r.status,
    valor_total: r.valor_total !== null ? Number(r.valor_total) : null,
    faturamento_previsto:
      r.faturamento_previsto !== null ? Number(r.faturamento_previsto) : null,
    data_inicio_prevista: r.data_inicio_prevista,
    projeto_id: r.projeto_id,
    projeto_codigo: r.projeto?.codigo ?? null,
    projeto_nome: r.projeto?.nome ?? null,
    cliente_nome: r.projeto?.cliente?.nome_fantasia ?? null,
    responsavel_nome: r.responsavel?.nome ?? null,
    empresa_id: r.empresa_id ?? null,
    empresa_nome: r.empresa?.nome_fantasia ?? r.empresa?.razao_social ?? null,
  }));

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Operação
        </p>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Briefcase className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Todos os jobs criados. Aprovados pelo financeiro liberam a gestão do
          realizado.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 shadow-soft text-center max-w-2xl mx-auto">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
            <Briefcase className="h-6 w-6" />
          </div>
          <h2 className="mt-6 text-xl font-semibold">Nenhum job criado ainda</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Aprove uma versão de orçamento e crie um job pelo drawer no
            orçamento aprovado.
          </p>
        </div>
      ) : (
        <JobsList rows={rows} empresas={empresas} />
      )}
    </div>
  );
}
