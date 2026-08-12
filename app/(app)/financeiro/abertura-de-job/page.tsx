import Link from "next/link";
import { redirect } from "next/navigation";
import { Landmark } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { listarFilaDeAbertura } from "./dados";
import { formatEnviadoEm } from "./formatos";
import { FilaAbertura, type FilaLinha } from "./fila-list";

export const dynamic = "force-dynamic";

export default async function AberturaDeJobPage() {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const fila = await listarFilaDeAbertura(session.activeTenant.id);

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

      {/* Barra de abas com uma aba só: "Jobs abertos" entra aqui na
          próxima entrega, junto com a marcação de faturamento. */}
      <div
        role="tablist"
        aria-label="Seções da abertura de job"
        className="flex items-center gap-1 border-b border-border"
      >
        <span
          role="tab"
          aria-selected="true"
          className="mr-5 inline-flex items-center gap-2 border-b-2 border-california-red px-1 py-3 text-sm font-semibold"
        >
          Jobs aguardando abertura
          <span className="inline-flex items-center rounded-full bg-california-red/10 px-2.5 py-0.5 font-mono text-[11px] font-bold text-[#b3323c]">
            {linhas.length}
          </span>
        </span>
      </div>

      <FilaAbertura linhas={linhas} />
    </div>
  );
}
