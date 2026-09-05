import Link from "next/link";
import {
  ArrowRight,
  Building2,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await requireAdmin();
  const service = createServiceClient();
  const tenantId = session.activeTenant.id;

  const [membersRes, empresasRes] = await Promise.all([
    service
      .from("tenant_members")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "ativo"),
    service
      .from("empresas")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("ativo", true),
  ]);

  const ativosCount = membersRes.count ?? 0;
  const empresasCount = empresasRes.count ?? 0;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Administração
        </p>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <ShieldCheck className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Administração
          </h1>
        </div>
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
          count={ativosCount}
          countLabel={ativosCount === 1 ? "ativo" : "ativos"}
        />
        <AdminCard
          href="/admin/empresas"
          icon={Building2}
          title="Empresas"
          description="Cadastre as pessoas jurídicas do grupo California."
          count={empresasCount}
          countLabel={empresasCount === 1 ? "ativa" : "ativas"}
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
