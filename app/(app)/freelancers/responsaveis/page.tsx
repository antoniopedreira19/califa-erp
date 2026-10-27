import Link from "next/link";
import { redirect } from "next/navigation";
import { UserCog, Users as UsersIcon } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";
import { initials } from "@/lib/utils";

export const dynamic = "force-dynamic";

const APROVADORES = new Set(["administrador", "rh", "financeiro"]);

const ROLES_RESPONSAVEL: AppRole[] = [
  "administrador",
  "rh",
  "financeiro",
  "gerente_producao",
  "produtor",
];

const ROLE_LABEL: Record<string, string> = {
  administrador: "Admin",
  rh: "RH",
  financeiro: "Financeiro",
  gerente_producao: "Gerente de produção",
  produtor: "Produtor",
};

export default async function ResponsaveisPage() {
  const session = await requireSession();
  if (!APROVADORES.has(session.activeRole)) {
    redirect("/freelancers?reason=sem_permissao_responsaveis");
  }

  const supabase = createClient();

  // Profiles ativos do tenant com role que pode ser responsavel
  // 1. Fonte da verdade: quem aparece como responsável em algum freela do
  //    tenant (freelancers.responsavel_id). Vale pra mostrar todo mundo que
  //    efetivamente gerencia alguém, independentemente do role atual.
  const { data: freelasRows } = await supabase
    .from("freelancers")
    .select("responsavel_id")
    .eq("tenant_id", session.activeTenant.id)
    .not("responsavel_id", "is", null);

  const contagem = new Map<string, number>();
  for (const row of (freelasRows ?? []) as Array<{ responsavel_id: string }>) {
    contagem.set(
      row.responsavel_id,
      (contagem.get(row.responsavel_id) ?? 0) + 1,
    );
  }

  // 2. Também inclui gente que PODE ser responsável mesmo sem freela atribuído
  //    (admin/rh/financeiro/GP/produtor ativos no tenant). Assim o RH ve quem
  //    está disponível pra assumir freelancers.
  const { data: membersRows } = await supabase
    .from("tenant_members")
    .select("user_id, role")
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "ativo")
    .in("role", ROLES_RESPONSAVEL);

  const rolesPorUserId = new Map<string, Set<string>>();
  for (const m of (membersRows ?? []) as Array<{
    user_id: string;
    role: string;
  }>) {
    const set = rolesPorUserId.get(m.user_id) ?? new Set<string>();
    set.add(m.role);
    rolesPorUserId.set(m.user_id, set);
  }

  // 3. Busca os profiles de ambas as fontes (dedup por id).
  const idsUniao = new Set<string>([
    ...contagem.keys(),
    ...rolesPorUserId.keys(),
  ]);

  const profilesPorId = new Map<
    string,
    { id: string; nome: string; email: string | null; ativo: boolean }
  >();
  if (idsUniao.size > 0) {
    const { data: profilesRows } = await supabase
      .from("profiles")
      .select("id, nome, email, ativo")
      .in("id", Array.from(idsUniao));
    for (const p of (profilesRows ?? []) as Array<{
      id: string;
      nome: string;
      email: string | null;
      ativo: boolean;
    }>) {
      profilesPorId.set(p.id, p);
    }
  }

  // 4. Monta a lista final. Inclui mesmo quem tem profile inativo mas é
  //    responsável de freela — RH precisa enxergar pra transferir.
  const responsaveis = Array.from(idsUniao)
    .map((id) => {
      const p = profilesPorId.get(id);
      if (!p) return null;
      return {
        id,
        nome: p.nome,
        email: p.email,
        ativo: p.ativo,
        roles: rolesPorUserId.get(id) ?? new Set<string>(),
      };
    })
    .filter(
      (r): r is {
        id: string;
        nome: string;
        email: string | null;
        ativo: boolean;
        roles: Set<string>;
      } => r !== null,
    )
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const totalFreelas = Array.from(contagem.values()).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <UserCog className="h-3.5 w-3.5 text-california-red" />
            <span>Time</span>
          </div>
          <h1 className="mt-2 text-2xl md:text-[28px] font-bold tracking-tight text-foreground">
            Responsáveis
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quem gerencia os freelancers da agência. Clique num responsável
            pra ver os freelas dele.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Freelancers atribuídos
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
            {totalFreelas}
          </p>
        </div>
      </header>

      <div className="rounded-2xl border border-border bg-white shadow-soft overflow-hidden">
        {responsaveis.length === 0 ? (
          <div className="px-5 py-20 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-california-red/10">
              <UserCog className="h-5 w-5 text-california-red" />
            </div>
            <p className="mt-4 text-sm font-semibold text-foreground">
              Nenhum responsável no tenant
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Convide pessoas em Admin › Usuários pra começar.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <Th>Responsável</Th>
                  <Th>E-mail</Th>
                  <Th>Papel</Th>
                  <Th className="text-center">Freelancers</Th>
                </tr>
              </thead>
              <tbody>
                {responsaveis.map((r) => {
                  const n = contagem.get(r.id) ?? 0;
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-border last:border-0 group hover:bg-california-red/[0.02] transition-colors"
                    >
                      <td className="px-5 py-4">
                        <Link
                          href={`/freelancers/lista?responsavel=${r.id}`}
                          prefetch={false}
                          className="flex items-center gap-3 group/link"
                        >
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-california-red text-white text-xs font-bold shrink-0">
                            {initials(r.nome)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground group-hover/link:text-california-red transition-colors truncate">
                              {r.nome}
                            </p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-xs text-muted-foreground truncate max-w-[260px]">
                          {r.email ?? "—"}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1">
                          {Array.from(r.roles).map((role) => (
                            <span
                              key={role}
                              className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                            >
                              {ROLE_LABEL[role] ?? role}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-center">
                        {n > 0 ? (
                          <Link
                            href={`/freelancers/lista?responsavel=${r.id}`}
                            prefetch={false}
                            className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums text-foreground hover:text-california-red transition-colors"
                          >
                            <UsersIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            {n}
                          </Link>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground/60">
                            <UsersIcon className="h-3.5 w-3.5" />0
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground ${
        className ?? ""
      }`}
    >
      {children}
    </th>
  );
}
