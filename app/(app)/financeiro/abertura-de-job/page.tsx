import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Landmark } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { listarFilaDeAbertura, listarSavesNaFila } from "./dados";
import { listarJobsDoFinanceiro } from "./dados-abertos";
import { formatEnviadoEm } from "./formatos";
import { type FilaLinha, type SaveFilaLinha } from "./fila-list";
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

  // Três leituras independentes — em paralelo, nunca em série
  // (`docs/PERFORMANCE.md`). A terceira é a faixa Saves (decisão 099).
  const [fila, abertos, pedidosDeSave] = await Promise.all([
    listarFilaDeAbertura(session.activeTenant.id),
    listarJobsDoFinanceiro(session.activeTenant.id),
    listarSavesNaFila(session.activeTenant.id),
  ]);

  // "há 2 horas" é calculado aqui, no servidor, e desce como texto pronto:
  // calcular no client component causaria divergência de hidratação.
  const agora = new Date();
  const saves: SaveFilaLinha[] = pedidosDeSave.map((s) => ({
    ...s,
    enviado_em_label: formatEnviadoEm(s.enviadoEm, agora),
  }));
  // O job cuja revisão da abertura existe SÓ por pedidos de save aparece
  // só na faixa Saves (decisão 099): aprovar o save é registrar a revisão.
  // Só sai da faixa Erratas se o pedido estiver mesmo na faixa Saves — sem
  // isso, uma leitura que falhasse sumiria com o job das duas.
  const comSaveNaFila = new Set(saves.map((s) => s.jobId));
  const linhas: FilaLinha[] = fila
    .filter((j) => !(j.revisao?.soDeSave && comSaveNaFila.has(j.id)))
    .map((j) => ({
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
        saves={saves}
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
