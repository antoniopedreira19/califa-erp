import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, ArrowRight, type LucideIcon } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function CentralRHPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();

  const [colaboradoresAtivosRes] = await Promise.all([
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo"),
  ]);
  const colaboradoresAtivos = colaboradoresAtivosRes.count ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="RH"
        title="Recursos Humanos"
        description="Cadastro de colaboradores, alocação por empresa e regional, e histórico salarial. Benefícios, férias e folha entram nas próximas fases."
        icon={Users}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <RhCard
          href="/rh/colaboradores"
          icon={Users}
          title="Colaboradores"
          description="Cadastro do quadro atual e inativos, com nível de cargo, alocação vigente por empresa/regional e histórico salarial."
          count={colaboradoresAtivos}
          countLabel={colaboradoresAtivos === 1 ? "ativo" : "ativos"}
        />
        {/* Próximos cards: Benefícios, Férias, Turnover, Folha */}
      </div>
    </div>
  );
}

function RhCard({
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
  count?: number;
  countLabel?: string;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="group relative flex flex-col rounded-2xl border border-border bg-card p-6 shadow-soft transition-all hover:border-california-red/30 hover:shadow-elevated"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-foreground group-hover:text-california-red transition-colors">
        {title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {count !== undefined && (
        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{count}</span>{" "}
            {countLabel ?? "registros"}
          </p>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
            Abrir
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      )}
      {count === undefined && (
        <div className="mt-6 flex items-center justify-end border-t border-border pt-4">
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
            Abrir
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      )}
    </Link>
  );
}
