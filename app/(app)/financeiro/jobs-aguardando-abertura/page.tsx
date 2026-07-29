import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Clock } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { JobsAguardandoList, type JobAguardandoRow } from "./jobs-aguardando-list";

export const dynamic = "force-dynamic";

export default async function JobsAguardandoAberturaPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, codigo, nome, valor_total, data_inicio_prevista, orcamento_id, projeto_id, responsavel:profiles!responsavel_id(nome), regional:regionais(nome), projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia))",
    )
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "aguardando_abertura")
    .order("created_at", { ascending: true });

  if (error) console.error("[jobs-aguardando]", error.message);

  const rows: JobAguardandoRow[] = ((data ?? []) as any[]).map((j) => ({
    id: j.id,
    codigo: j.codigo,
    nome: j.nome,
    valor_total: j.valor_total !== null ? Number(j.valor_total) : null,
    data_inicio_prevista: j.data_inicio_prevista,
    orcamento_id: j.orcamento_id,
    projeto_id: j.projeto_id,
    projeto_codigo: j.projeto?.codigo ?? null,
    projeto_nome: j.projeto?.nome ?? null,
    cliente_nome: j.projeto?.cliente?.nome_fantasia ?? null,
    responsavel_nome: j.responsavel?.nome ?? null,
    regional_nome: j.regional?.nome ?? null,
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <nav className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Link href="/financeiro" className="hover:text-foreground">Central Financeira</Link>
          <ChevronRight className="h-3 w-3" />
          <span>Jobs Aguardando Abertura</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Clock className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Jobs Aguardando Abertura</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Confira os dados e aprove ou rejeite a abertura de cada job.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">Nenhum job aguardando abertura no momento.</p>
        </div>
      ) : (
        <JobsAguardandoList rows={rows} />
      )}
    </div>
  );
}
