import { redirect } from "next/navigation";
import { PieChart } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { listarJobsDoFinanceiro } from "../abertura-de-job/dados-abertos";
import { JobsAbertosList } from "../abertura-de-job/jobs-abertos-list";

export const dynamic = "force-dynamic";

/**
 * Resultado de Job (decisão 207, 23/10/2026): a lista dos jobs do
 * financeiro com Valor do Job, Faturamento e Rentabilidade — a mesma lista
 * da aba "Visualizar Jobs" da Abertura de Job, num módulo próprio da
 * Central Financeira. A carga é a da aba (`listarJobsDoFinanceiro`), e a
 * Rentabilidade de cada linha é a mesma da página do job.
 */
export default async function ResultadoDeJobPage() {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const linhas = await listarJobsDoFinanceiro(session.activeTenant.id);

  return (
    <div className="space-y-6">
      <div>
        <BotaoVoltar reserva="/financeiro" />
      </div>
      <PageHeader
        eyebrow="FINANCEIRO"
        title="Resultado de Job"
        description="Valor, faturamento e rentabilidade de cada job no financeiro, por projeto ou por job."
        icon={PieChart}
      />
      <JobsAbertosList linhas={linhas} tela="resultado" />
    </div>
  );
}
