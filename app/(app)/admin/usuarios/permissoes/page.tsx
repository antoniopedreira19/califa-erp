import { ShieldCheck } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { MatrizPermissoes } from "./matriz-permissoes";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";

export const dynamic = "force-dynamic";

export default async function AdminPermissoesPage() {
  // Segunda barreira alem do requireAdmin do layout: esta tela expoe
  // todas as decisoes de acesso do sistema.
  await requireAdmin();

  return (
    <div className="space-y-8">
      <BotaoVoltar reserva="/admin/usuarios" />

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
