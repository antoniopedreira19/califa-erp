import { Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default function FreelancersListaPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Freelancers"
        title="Freelancers"
        description="Cadastro de pessoas e seus contratos. Busca por nome ou CPF, filtros por status e cargo, exportação."
        icon={Users}
      />

      <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center">
        <p className="text-sm font-medium text-foreground">Em construção</p>
        <p className="mt-1 text-sm text-muted-foreground max-w-xl mx-auto">
          Aqui virá a tabela densa de freelancers com busca, chips de filtro (status do
          trabalho, status do contrato, ação prevista), 4 cards de análise rápida, botão
          &quot;Novo freelancer&quot;, botão &quot;Gerenciar cargos&quot; (abre dialog) e exportação.
          Implementação na Task 013.
        </p>
      </div>
    </div>
  );
}
