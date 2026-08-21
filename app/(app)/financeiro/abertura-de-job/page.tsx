import Link from "next/link";
import { redirect } from "next/navigation";
import { Landmark } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { listarFilaDeAbertura } from "./dados";
import { listarJobsDoFinanceiro } from "./dados-abertos";
import { formatEnviadoEm } from "./formatos";
import { type FilaLinha } from "./fila-list";
import { AberturaTabs } from "./abertura-tabs";

export const dynamic = "force-dynamic";

export default async function AberturaDeJobPage() {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  // Duas queries independentes — em paralelo, nunca em série
  // (`docs/PERFORMANCE.md`).
  const [fila, abertos] = await Promise.all([
    listarFilaDeAbertura(session.activeTenant.id),
    listarJobsDoFinanceiro(session.activeTenant.id),
  ]);

  // "há 2 horas" é calculado aqui, no servidor, e desce como texto pronto:
  // calcular no client component causaria divergência de hidratação.
  const agora = new Date();
  const linhas: FilaLinha[] = fila.map((j) => ({
    ...j,
    enviado_em_label: formatEnviadoEm(j.created_at, agora),
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          href="/financeiro"
          className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red hover:text-california-red-hover"
        >
          Central Financeira
        </Link>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Landmark className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Abertura de Job</h1>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Confira e abra os jobs enviados pela produção. Depois de abertos, eles
          ficam disponíveis para acompanhamento e faturamento.
        </p>
      </header>

      <AberturaTabs fila={linhas} abertos={abertos} />
    </div>
  );
}
