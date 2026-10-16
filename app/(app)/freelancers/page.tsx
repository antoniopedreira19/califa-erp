import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default function FreelancersDashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Freelancers"
        title="Dashboard"
        description="Visão geral do módulo: alertas, solicitações pendentes, performance por responsável e novos contratos."
        icon={LayoutDashboard}
      />

      <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center">
        <p className="text-sm font-medium text-foreground">Em construção</p>
        <p className="mt-1 text-sm text-muted-foreground max-w-xl mx-auto">
          Nesta aba virá o hero com saudação, cards de análise rápida (na ativa / em dia /
          irregular / encerrados), ações previstas, solicitações pendentes, novos contratos
          por período e performance por responsável. Implementação na Task 015.
        </p>
      </div>
    </div>
  );
}
