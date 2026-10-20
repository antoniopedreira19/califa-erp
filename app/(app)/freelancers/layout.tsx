import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import { FreelancersSubNav } from "./_components/sub-nav";

const APROVADORES = new Set(["administrador", "rh", "financeiro"]);

export default async function FreelancersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  if (!pode(session.activeRole, "sidebar.freelancers")) {
    redirect("/home?reason=sem_permissao_freelancers");
  }

  // Badge na tab Solicitações:
  // - aprovador: contagem de 'pendente' (fila de aprovação)
  // - GP/produtor: contagem de 'pendente' + 'aprovada' das próprias
  //   (coisas que ainda precisam de ação)
  const supabase = createClient();
  const isAprovador = APROVADORES.has(session.activeRole);
  let query = supabase
    .from("freelancer_solicitacoes")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", session.activeTenant.id);
  if (isAprovador) {
    query = query.eq("status", "pendente");
  } else {
    query = query
      .eq("solicitante_id", session.profile.id)
      .in("status", ["pendente", "aprovada"]);
  }
  const { count } = await query;
  const countSolicitacoes = count ?? 0;

  return (
    <div className="space-y-0">
      <FreelancersSubNav countSolicitacoes={countSolicitacoes} />
      {children}
    </div>
  );
}
