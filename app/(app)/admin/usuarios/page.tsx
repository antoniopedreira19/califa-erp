import Link from "next/link";
import {
  ArrowLeft,
  Table2,
  UserPlus,
  Users,
} from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";
import { ConvidarUsuarioDrawer } from "./convidar-drawer";
import { UsuariosLista, type UsuarioRow } from "./usuarios-lista";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function AdminUsuariosPage() {
  const session = await requireAdmin();

  // Usa service client para garantir a listagem completa, mesmo que a policy
  // de admin evolua no futuro. A autorização já foi feita por requireAdmin.
  const service = createServiceClient();
  const tenantId = session.activeTenant.id;

  // GoTrue admin.listUsers estoura HTTP 500 com perPage >= 100 (dependência
  // interna de decodificação em batch). Fatiamos em páginas de 50 e agregamos.
  async function listarAuthUsersPaginado() {
    type AuthUserLite = { id: string; email_confirmed_at: string | null };
    const acc: AuthUserLite[] = [];
    const perPage = 50;
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await service.auth.admin.listUsers({
        page,
        perPage,
      });
      if (error) return { data: null, error };
      const batch = data?.users ?? [];
      for (const u of batch) {
        acc.push({
          id: u.id,
          email_confirmed_at: u.email_confirmed_at ?? null,
        });
      }
      if (batch.length < perPage) break;
    }
    return { data: acc, error: null as null };
  }

  const [
    membersRes,
    empresasRes,
    regionaisRes,
    authListingRes,
  ] = await Promise.all([
    service
      .from("tenant_members")
      .select("user_id, role, status, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true }),
    service
      .from("empresas")
      .select("id, razao_social, nome_fantasia")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("nome_fantasia"),
    service
      .from("regionais")
      .select("id, nome, empresa_id")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("nome"),
    listarAuthUsersPaginado(),
  ]);

  if (membersRes.error) {
    console.error("[admin.usuarios.list.members]", membersRes.error.message);
  }
  if (empresasRes.error) {
    console.error("[admin.usuarios.list.empresas]", empresasRes.error.message);
  }
  if (regionaisRes.error) {
    console.error(
      "[admin.usuarios.list.regionais]",
      regionaisRes.error.message,
    );
  }

  const members = membersRes.data ?? [];
  const empresas = empresasRes.data ?? [];
  const regionais = regionaisRes.data ?? [];

  const userIds = members.map((m) => m.user_id);
  const { data: profiles } = userIds.length
    ? await service
        .from("profiles")
        .select("id, nome, email, ativo")
        .in("id", userIds)
    : { data: [] as { id: string; nome: string; email: string; ativo: boolean }[] };

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const emailConfirmadoById = new Map<string, boolean>();
  const authFalhou = !!authListingRes.error;
  if (authListingRes.error) {
    console.error(
      "[admin.usuarios.list.auth-users]",
      authListingRes.error.message,
    );
  } else {
    for (const u of authListingRes.data ?? []) {
      emailConfirmadoById.set(u.id, Boolean(u.email_confirmed_at));
    }
  }

  const rows: UsuarioRow[] = members.map((m) => {
    const profile = byId.get(m.user_id) ?? null;
    const perfilAtivo = profile?.ativo ?? true;
    const vinculoAtivo = m.status === "ativo";
    // Se o listUsers falhou completamente, preserva o comportamento anterior
    // (assume confirmado) pra não marcar todo mundo como pendente à toa. Se o
    // listUsers respondeu mas o user_id não veio, aí SIM assume pendente — é
    // um estado real de "usuário existe em tenant_members mas não em auth", ou
    // acabou de ser convidado e paginação ainda não pegou. Melhor errar pra
    // pendente do que dizer "ativo" e esconder o botão de reenviar convite.
    const emailConfirmado = authFalhou
      ? true
      : (emailConfirmadoById.get(m.user_id) ?? false);

    let acesso: "ativo" | "pendente" | "inativo";
    if (!perfilAtivo || !vinculoAtivo) acesso = "inativo";
    else if (!emailConfirmado) acesso = "pendente";
    else acesso = "ativo";

    return {
      user_id: m.user_id,
      role: m.role as AppRole,
      status: m.status as "ativo" | "inativo",
      profileAtivo: perfilAtivo,
      acesso,
      nome: profile?.nome ?? "—",
      email: profile?.email ?? "—",
    };
  });

  return (
    <div className="space-y-8">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-california-red transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para Administração
      </Link>

      <PageHeader
        eyebrow="ADMINISTRAÇÃO"
        title="Usuários"
        description="Convide novos membros do time para o California ERP. O usuário recebe um e-mail com link para definir a senha e ativar o acesso. Clique em uma linha para editar o papel e as permissões de acesso a empresas."
        icon={Users}
        actions={
          <>
            <Link
              href="/admin/usuarios/permissoes"
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm hover:bg-accent transition-colors"
            >
              <Table2 className="h-4 w-4" />
              Ver matriz de permissões
            </Link>
            <ConvidarUsuarioDrawer
              empresas={empresas}
              regionais={regionais}
            />
          </>
        }
      />

      <UsuariosLista
        rows={rows}
        currentUserId={session.profile.id}
        empresas={empresas}
        regionais={regionais}
      />

      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
        <UserPlus className="h-4 w-4 mt-0.5 shrink-0 text-california-red" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Como funciona o convite</p>
          <p>
            Ao convidar, o usuário recebe um e-mail para ativar a conta. Ele
            cria a própria senha na tela de ativação e já entra com o papel
            escolhido. As permissões de acesso a empresas definidas no convite
            são aplicadas assim que o usuário aceita.
          </p>
        </div>
      </div>
    </div>
  );
}
