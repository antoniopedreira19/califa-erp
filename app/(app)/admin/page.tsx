import Link from "next/link";
import { ArrowRight, Users, type LucideIcon } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await requireAdmin();
  const service = createServiceClient();

  const { count: ativosCount } = await service
    .from("tenant_members")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "ativo");

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Administração
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          Configurações do sistema
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Gestão de acesso, papéis e regras internas do California ERP.
          Disponível apenas para administradores.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <AdminCard
          href="/admin/usuarios"
          icon={Users}
          title="Usuários"
          description="Convide novos membros e defina o papel de cada um dentro do tenant."
          count={ativosCount ?? 0}
          countLabel={(ativosCount ?? 0) === 1 ? "ativo" : "ativos"}
        />
      </div>
    </div>
  );
}

function AdminCard({
  href,
  icon: Icon,
  title,
  description,
  count,
  countLabel,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  count: number;
  countLabel: string;
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

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{count}</span>{" "}
          {countLabel}
        </p>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
          Abrir
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
