import { Briefcase } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { JobsList, type JobRow } from "./jobs-list";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const session = await requireSession();
  const supabase = createClient();

  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, codigo, nome, status, valor_total, data_inicio_prevista, job_pai_id, " +
        "projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia)), " +
        "responsavel:profiles!responsavel_id(nome), " +
        "pai:jobs!job_pai_id(id, codigo)",
    )
    .eq("tenant_id", session.activeTenant.id)
    .order("created_at", { ascending: false });

  if (error) console.error("[jobs.list]", error.message);

  const rows: JobRow[] = (data ?? []).map((r: any) => ({
    id: r.id,
    codigo: r.codigo,
    nome: r.nome,
    status: r.status,
    valor_total: r.valor_total !== null ? Number(r.valor_total) : null,
    data_inicio_prevista: r.data_inicio_prevista,
    projeto_codigo: r.projeto?.codigo ?? null,
    projeto_nome: r.projeto?.nome ?? null,
    cliente_nome: r.projeto?.cliente?.nome_fantasia ?? null,
    responsavel_nome: r.responsavel?.nome ?? null,
    pai_id: r.pai?.id ?? null,
    pai_codigo: r.pai?.codigo ?? null,
  }));

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Operacao
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Todos os jobs criados. Aprovados pelo financeiro liberam a gestao do
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
            Aprove uma versao de orcamento e crie um job pelo drawer no
            orcamento aprovado.
          </p>
        </div>
      ) : (
        <JobsList rows={rows} />
      )}
    </div>
  );
}
