import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Landmark } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { listarFilaDeAbertura } from "./dados";
import { listarJobsDoFinanceiro } from "./dados-abertos";
import { formatEnviadoEm } from "./formatos";
import { type FilaLinha } from "./fila-list";
import { AberturaTabs, type Aba } from "./abertura-tabs";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function AberturaDeJobPage({
  searchParams,
}: {
  searchParams?: { aba?: string };
}) {
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

  // O "hoje" do calendário sai daqui, no fuso de Brasília, pelo mesmo
  // motivo do rótulo acima: calculado dentro do client component, o
  // servidor renderizaria numa data e o navegador em outra sempre que a
  // máquina de quem usa estivesse noutro fuso — e o React acusaria
  // divergência de hidratação. `en-CA` porque é o locale que já formata
  // em `YYYY-MM-DD`, que é a forma com que o calendário compara datas.
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/financeiro"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para central financeira
        </Link>
      </div>
      <PageHeader
        eyebrow="FINANCEIRO"
        title="Abertura de Job"
        description="Confira e abra os jobs enviados pela produção. Depois de abertos, eles ficam disponíveis para acompanhamento e faturamento."
        icon={Landmark}
      />

      <AberturaTabs
        fila={linhas}
        abertos={abertos}
        hoje={hoje}
        abaInicial={
          searchParams?.aba === "abertos" ||
          searchParams?.aba === "aguardando" ||
          searchParams?.aba === "calendario"
            ? (searchParams.aba as Aba)
            : undefined
        }
      />
    </div>
  );
}
