import { Briefcase } from "lucide-react";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  await requireSession();

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Operação
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Cada orçamento aprovado vira um job. A gestão detalhada (planejado, realizado, produção) chega em breve.
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-card p-12 shadow-soft text-center max-w-2xl mx-auto">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
          <Briefcase className="h-6 w-6" />
        </div>
        <h2 className="mt-6 text-xl font-semibold">Gestão de jobs em breve</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Por enquanto, jobs são criados a partir do orçamento aprovado. A visão consolidada com filtros, planejado × realizado, produção e financeiro fica pra próxima fase.
        </p>
      </div>
    </div>
  );
}
