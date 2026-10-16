import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default function FreelancersSolicitacoesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Freelancers"
        title="Solicitações"
        description="Pedidos de contratação feitos pelos gerentes, aguardando aprovação do RH ou Financeiro."
        icon={ClipboardList}
      />

      <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center">
        <p className="text-sm font-medium text-foreground">Em construção</p>
        <p className="mt-1 text-sm text-muted-foreground max-w-xl mx-auto">
          Aqui virá a lista completa de solicitações com filtros, popover com chat
          integrado (realtime), botões de aprovar/rejeitar/cancelar e geração do link
          público para o freelancer preencher os dados pessoais. Implementação na Fase 3
          (Tasks 017+).
        </p>
      </div>
    </div>
  );
}
