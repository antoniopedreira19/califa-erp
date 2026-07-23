import Link from "next/link";
import { ArrowLeft, ShieldCheck, UserPlus } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { roleLabel, type AppRole } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { ConvidarUsuarioDrawer } from "./convidar-drawer";

export const dynamic = "force-dynamic";

interface MemberRow {
  user_id: string;
  role: AppRole;
  status: "ativo" | "inativo";
  created_at: string;
  profile: {
    id: string;
    nome: string;
    email: string;
    ativo: boolean;
  } | null;
}

export default async function AdminUsuariosPage() {
  const session = await requireAdmin();

  // Usa service client para garantir a listagem completa, mesmo que a policy
  // de admin evolua no futuro. A autorização já foi feita por requireAdmin.
  const service = createServiceClient();

  const { data: members, error } = await service
    .from("tenant_members")
    .select("user_id, role, status, created_at")
    .eq("tenant_id", session.activeTenant.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[admin.usuarios.list.members]", error.message);
  }

  const userIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = userIds.length
    ? await service
        .from("profiles")
        .select("id, nome, email, ativo")
        .in("id", userIds)
    : { data: [] as { id: string; nome: string; email: string; ativo: boolean }[] };

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const rows: MemberRow[] = (members ?? []).map((m) => ({
    user_id: m.user_id,
    role: m.role as AppRole,
    status: m.status as "ativo" | "inativo",
    created_at: m.created_at as string,
    profile: byId.get(m.user_id) ?? null,
  }));

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-california-red transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para Administração
      </Link>

      <header className="flex items-start justify-between gap-6">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
            Administração
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Usuários</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Convide novos membros do time para o California ERP. O usuário
            recebe um e-mail com link para definir a senha e ativar o acesso.
          </p>
        </div>
        <ConvidarUsuarioDrawer />
      </header>

      <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum usuário cadastrado ainda.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-semibold px-6 py-3">Nome</th>
                <th className="text-left font-semibold px-6 py-3">E-mail</th>
                <th className="text-left font-semibold px-6 py-3">Papel</th>
                <th className="text-left font-semibold px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const nome = row.profile?.nome ?? "—";
                const email = row.profile?.email ?? "—";
                const perfilAtivo = row.profile?.ativo ?? true;
                const vinculoAtivo = row.status === "ativo";
                const acessoOk = perfilAtivo && vinculoAtivo;
                return (
                  <tr
                    key={row.user_id}
                    className="hover:bg-accent/40 transition-colors"
                  >
                    <td className="px-6 py-3.5 font-medium text-foreground">
                      {nome}
                      {row.user_id === session.profile.id && (
                        <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-california-red">
                          você
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-muted-foreground">
                      {email}
                    </td>
                    <td className="px-6 py-3.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                        {row.role === "administrador" && (
                          <ShieldCheck className="h-3.5 w-3.5 text-california-red" />
                        )}
                        {roleLabel(row.role)}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      {acessoOk ? (
                        <Badge className="bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10 border-emerald-500/20">
                          Ativo
                        </Badge>
                      ) : (
                        <Badge className="bg-muted text-muted-foreground hover:bg-muted border-border">
                          Inativo
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
        <UserPlus className="h-4 w-4 mt-0.5 shrink-0 text-california-red" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Como funciona o convite</p>
          <p>
            Ao convidar, o usuário recebe um e-mail para ativar a conta. Ele
            cria a própria senha na tela de ativação e já entra com o papel
            escolhido. Ações como inativar e trocar papel serão adicionadas em
            seguida.
          </p>
        </div>
      </div>
    </div>
  );
}
