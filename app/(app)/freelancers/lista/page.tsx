import Link from "next/link";
import { Users, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import { PageHeader } from "@/components/ui/page-header";
import type { Freelancer, FreelancerCargo } from "@/lib/types";
import { ListaClient } from "./_components/lista-client";
import { BuscaInput } from "./_components/busca-input";
import { GerenciarCargosDialog } from "./_components/gerenciar-cargos-dialog";

export const dynamic = "force-dynamic";

const ACOES_VALIDAS = new Set([
  "contratar",
  "renovar",
  "manter",
  "substituir",
  "encerrar",
  "sem_decisao",
]);

export default async function FreelancersListaPage({
  searchParams,
}: {
  searchParams: { q?: string; acao?: string };
}) {
  const session = await requireSession();
  if (!pode(session.activeRole, "sidebar.freelancers")) {
    redirect("/home?reason=sem_permissao_freelancers");
  }

  const supabase = createClient();

  // Query de freelancers com filtros server-side
  let query = supabase
    .from("freelancers")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .order("nome_social", { ascending: true });

  const termo = searchParams.q?.trim();
  if (termo) {
    // CPF puro no banco é só dígitos — se o usuário digitou 123.456.789-01
    // o ilike não vai casar. Fazemos busca em nome_social, nome_completo
    // e cpf (comparando com e sem máscara).
    const soDigitos = termo.replace(/\D+/g, "");
    const likeNome = `%${termo}%`;
    const condicoes = [
      `nome_social.ilike.${likeNome}`,
      `nome_completo.ilike.${likeNome}`,
    ];
    if (soDigitos.length >= 3) {
      condicoes.push(`cpf.ilike.%${soDigitos}%`);
    }
    query = query.or(condicoes.join(","));
  }

  // Filtro por ação prevista — múltiplos separados por vírgula na URL
  const acoesFiltro = (searchParams.acao ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ACOES_VALIDAS.has(s));

  if (acoesFiltro.length > 0) {
    const temSemDecisao = acoesFiltro.includes("sem_decisao");
    const acoesConcretas = acoesFiltro.filter((a) => a !== "sem_decisao");

    if (temSemDecisao && acoesConcretas.length > 0) {
      // Combina: ação IS NULL OR ação IN (...)
      const inList = acoesConcretas.join(",");
      query = query.or(`acao_prevista.is.null,acao_prevista.in.(${inList})`);
    } else if (temSemDecisao) {
      query = query.is("acao_prevista", null);
    } else {
      query = query.in("acao_prevista", acoesConcretas);
    }
  }

  const [freelancersRes, cargosRes] = await Promise.all([
    query.returns<Freelancer[]>(),
    supabase
      .from("freelancer_cargos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("nome", { ascending: true })
      .returns<FreelancerCargo[]>(),
  ]);

  if (freelancersRes.error) {
    console.error("[freelancers.lista]", freelancersRes.error.message);
  }
  if (cargosRes.error) {
    console.error("[freelancers.cargos]", cargosRes.error.message);
  }

  const freelancers = freelancersRes.data ?? [];
  const cargos = cargosRes.data ?? [];

  const podeGerenciarCargos =
    session.activeRole === "administrador" || session.activeRole === "rh";
  const podeCriarFreelancer =
    session.activeRole === "administrador" ||
    session.activeRole === "rh" ||
    session.activeRole === "financeiro";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Freelancers"
        title="Freelancers"
        description="Cadastro de pessoas e seus contratos. Busca por nome ou CPF, filtros por status e cargo, exportação."
        icon={Users}
        actions={
          <div className="flex items-center gap-2">
            {podeGerenciarCargos && <GerenciarCargosDialog cargos={cargos} />}
            {podeCriarFreelancer && (
              <Link
                href="/freelancers/novo"
                prefetch={false}
                className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover transition-colors"
              >
                <Plus className="h-4 w-4" />
                Novo freelancer
              </Link>
            )}
          </div>
        }
      />

      <BuscaInput />

      <ListaClient freelancers={freelancers} />
    </div>
  );
}
