import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { MatrizPermissoes } from "./matriz-permissoes";

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

      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Administração
        </p>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <ShieldCheck className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Permissões por papel
          </h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Escolha um papel no topo pra ver o que ele pode fazer no sistema.
          As marcações são somente leitura — pra mudar uma permissão, edite
          a matriz no código e ela se propaga automaticamente.
        </p>
      </header>

      <MatrizPermissoes />
    </div>
  );
}
