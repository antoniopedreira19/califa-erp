import Link from "next/link";
import {
  ArrowRight,
  FolderKanban,
  Settings as SettingsIcon,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { pode } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const session = await requireSession();
  const role = session.activeRole;

  const podeCadastros = pode(role, "sidebar.cadastros");
  const podeAdministracao = pode(role, "sidebar.administracao");

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Configurações
        </p>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <SettingsIcon className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Configurações do sistema
          </h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Áreas de configuração do ERP California. Novas seções aparecem aqui
          à medida que os módulos vão sendo liberados.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {podeCadastros && (
          <ConfigCard
            href="/cadastros"
            icon={FolderKanban}
            title="Cadastros"
            description="Clientes, fornecedores, categorias, regionais, cidades, contas bancárias, plano de contas e cartões de crédito."
          />
        )}
        {podeAdministracao && (
          <ConfigCard
            href="/admin"
            icon={ShieldCheck}
            title="Administração"
            description="Gestão de usuários, papéis e empresas do tenant. Disponível apenas para administradores."
          />
        )}
      </div>
    </div>
  );
}

function ConfigCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col rounded-2xl border border-border bg-card p-6 shadow-soft transition-all hover:border-california-red/30 hover:shadow-elevated"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
        <Icon className="h-5 w-5" />
      </div>

      <h3 className="mt-4 text-lg font-semibold text-foreground group-hover:text-california-red transition-colors">
        {title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>

      <div className="mt-6 flex items-center justify-end border-t border-border pt-4">
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
          Abrir
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
