import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, Plus, GraduationCap, UserPlus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/empty-state";
import { ColaboradoresList, type ColaboradorRow } from "./colaboradores-list";

export const dynamic = "force-dynamic";

export default async function ColaboradoresPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();

  // Colaboradores + join com nível (para mostrar o código na coluna).
  const [colaboradoresRes, niveisRes] = await Promise.all([
    supabase
      .from("colaboradores")
      .select(
        "id, nome, tipo_contratacao, funcao, status, data_admissao, data_encerramento, nivel:niveis(id, codigo)",
      )
      .eq("tenant_id", session.activeTenant.id)
      .order("nome", { ascending: true }),
    supabase
      .from("niveis")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
  ]);

  if (colaboradoresRes.error) {
    console.error("[rh.colaboradores.page]", colaboradoresRes.error.message);
  }

  const linhas: ColaboradorRow[] = ((colaboradoresRes.data ?? []) as any[]).map(
    (c) => ({
      id: c.id,
      nome: c.nome,
      tipo_contratacao: c.tipo_contratacao,
      funcao: c.funcao,
      status: c.status,
      data_admissao: c.data_admissao,
      data_encerramento: c.data_encerramento,
      nivel_codigo: c.nivel?.codigo ?? null,
    }),
  );

  const niveisAtivosCount = niveisRes.count ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="RH"
        title="Colaboradores"
        description="Cadastro do quadro atual e inativos. Nível de cargo, alocação por empresa e regional, histórico salarial."
        icon={Users}
      />

      {linhas.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="Nenhum colaborador cadastrado ainda"
          description="Cadastre o primeiro colaborador para começar a alimentar o quadro da agência."
          action={
            <Link
              href="/rh/colaboradores/novo"
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
            >
              <Plus className="h-4 w-4" />
              Cadastrar colaborador
            </Link>
          }
        />
      ) : (
        <ColaboradoresList
          colaboradores={linhas}
          niveisAtivosCount={niveisAtivosCount}
        />
      )}
    </div>
  );
}
