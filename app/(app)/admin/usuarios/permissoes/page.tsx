import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { MatrizPermissoes } from "./matriz-permissoes";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function AdminPermissoesPage() {
  // Segunda barreira alem do requireAdmin do layout: esta tela expoe
  // todas as decisoes de acesso do sistema.
  await requireAdmin();

  return (
    <div className="space-y-8">
      <Link
        href="/admin/usuarios"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-california-red transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para Usuários
      </Link>

      <PageHeader
        eyebrow="ADMINISTRAÇÃO"
        title="Permissões por papel"
        description="Escolha um papel no topo pra ver o que ele pode fazer no sistema. As marcações são somente leitura — pra mudar uma permissão, edite a matriz no código e ela se propaga automaticamente."
        icon={ShieldCheck}
      />

      <MatrizPermissoes />
    </div>
  );
}
