import Link from "next/link";
import { Briefcase } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { FreelancerJobInterno } from "@/lib/types";
import { AbasOrigem } from "./_components/abas-origem";
import { JobsInternosTabela } from "./_components/jobs-internos-tabela";

export const dynamic = "force-dynamic";

// Página de jobs da aba Freelancers. Duas origens:
//   `aba=producao` → lista básica (código + nome) dos jobs de produção. Não
//                    é o /jobs completo — aqui a aba Freelancers só precisa
//                    saber que jobs existem pra referenciar em contrato.
//   `aba=interno`  → CRUD dos jobs internos de freelancer (tabela
//                    `freelancer_jobs_internos`), que não existem no fluxo
//                    de orçamento/PP/faturamento.

const PODE_ESCREVER_INTERNO = new Set([
  "administrador",
  "rh",
  "financeiro",
]);

export default async function FreelancersJobsPage({
  searchParams,
}: {
  searchParams?: { aba?: string };
}) {
  const session = await requireSession();
  const supabase = createClient();
  const aba = searchParams?.aba === "interno" ? "interno" : "producao";

  // Contagem das duas origens em paralelo — pros pills ficarem sempre com
  // o número certo independentemente da aba selecionada.
  const [countProducaoRes, countInternoRes] = await Promise.all([
    supabase
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .neq("status", "cancelado"),
    supabase
      .from("freelancer_jobs_internos")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .is("arquivado_em", null),
  ]);

  const countProducao = countProducaoRes.count ?? 0;
  const countInterno = countInternoRes.count ?? 0;

  return (
    <div className="space-y-6">
      <AbasOrigem countProducao={countProducao} countInterno={countInterno} />

      {aba === "producao" ? (
        <AbaProducao
          supabase={supabase}
          tenantId={session.activeTenant.id}
        />
      ) : (
        <AbaInterno
          supabase={supabase}
          tenantId={session.activeTenant.id}
          podeEscrever={PODE_ESCREVER_INTERNO.has(session.activeRole)}
        />
      )}
    </div>
  );
}

async function AbaProducao({
  supabase,
  tenantId,
}: {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
}) {
  // Lista básica — só código + nome. Pro módulo Freelancers isso basta
  // (o /jobs continua sendo o lugar de fluxo completo).
  const { data, error } = await supabase
    .from("jobs")
    .select("id, codigo, nome")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelado")
    .order("codigo", { ascending: true });

  if (error) {
    console.error("[freelancers.jobs.producao]", error.message);
  }

  const jobs = (data ?? []) as Array<{ id: string; codigo: string; nome: string }>;

  if (jobs.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-12 shadow-soft text-center max-w-2xl mx-auto">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
          <Briefcase className="h-6 w-6" />
        </div>
        <h2 className="mt-6 text-xl font-semibold">Nenhum job de produção</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Jobs de produção nascem a partir de orçamentos aprovados em
          /orcamentos.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-3 w-[140px]">Código</th>
            <th className="text-left px-4 py-3">Nome</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {jobs.map((j) => (
            <tr key={j.id} className="hover:bg-muted/20 transition-colors">
              <td className="px-4 py-3">
                <Link
                  href={`/jobs/${j.id}`}
                  prefetch={false}
                  className="font-mono text-xs font-semibold text-california-red hover:underline"
                >
                  {j.codigo}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/jobs/${j.id}`}
                  prefetch={false}
                  className="hover:underline"
                >
                  {j.nome}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function AbaInterno({
  supabase,
  tenantId,
  podeEscrever,
}: {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
  podeEscrever: boolean;
}) {
  // Ativos primeiro, depois arquivados — ambos aparecem (arquivado some do
  // picker, mas o CRUD mostra pra permitir desarquivar).
  const { data, error } = await supabase
    .from("freelancer_jobs_internos")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("arquivado_em", { ascending: true, nullsFirst: true })
    .order("nome", { ascending: true });

  if (error) {
    console.error("[freelancers.jobs.internos]", error.message);
  }

  const jobs = (data ?? []) as FreelancerJobInterno[];

  return <JobsInternosTabela jobs={jobs} podeEscrever={podeEscrever} />;
}
