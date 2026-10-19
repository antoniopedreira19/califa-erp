import Link from "next/link";
import { Users, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import { PageHeader } from "@/components/ui/page-header";
import type { FreelancerComStatus, FreelancerCargo } from "@/lib/types";
import { ListaClient } from "./_components/lista-client";
import { BuscaInput } from "./_components/busca-input";
import { GerenciarCargosDialog } from "./_components/gerenciar-cargos-dialog";
import { CardsAnalise, type CategoriaCard } from "./_components/cards-analise";
import { ChipsStatus } from "./_components/chips-status";
import { ExportarButton } from "./_components/exportar-button";

export const dynamic = "force-dynamic";

const ACOES_VALIDAS = new Set([
  "contratar",
  "renovar",
  "manter",
  "substituir",
  "encerrar",
  "sem_decisao",
]);

const STATUS_VALIDOS = new Set([
  "regular",
  "vencendo",
  "irregular",
  "sem_minuta",
  "sem_assinado",
  "agendado",
  "pendente",
  "encerrado",
  "limbo",
]);

const CARDS_VALIDOS = new Set<CategoriaCard>([
  "na-ativa",
  "em-dia",
  "irregular",
  "encerrados",
]);

export default async function FreelancersListaPage({
  searchParams,
}: {
  searchParams: {
    q?: string;
    acao?: string;
    status?: string;
    card?: string;
    inicio_apos?: string;
    responsavel?: string;
  };
}) {
  const session = await requireSession();
  if (!pode(session.activeRole, "sidebar.freelancers")) {
    redirect("/home?reason=sem_permissao_freelancers");
  }

  const supabase = createClient();

  // Query principal consome a view `freelancers_com_status` — ela traz
  // cargo e status derivado do contrato ativo.
  let query = supabase
    .from("freelancers_com_status")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .order("nome_social", { ascending: true });

  const termo = searchParams.q?.trim();
  if (termo) {
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

  // Filtro por ação prevista
  const acoesFiltro = (searchParams.acao ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ACOES_VALIDAS.has(s));

  if (acoesFiltro.length > 0) {
    const temSemDecisao = acoesFiltro.includes("sem_decisao");
    const acoesConcretas = acoesFiltro.filter((a) => a !== "sem_decisao");
    if (temSemDecisao && acoesConcretas.length > 0) {
      const inList = acoesConcretas.join(",");
      query = query.or(`acao_prevista.is.null,acao_prevista.in.(${inList})`);
    } else if (temSemDecisao) {
      query = query.is("acao_prevista", null);
    } else {
      query = query.in("acao_prevista", acoesConcretas);
    }
  }

  // Filtro por status_calculado via chips
  const statusFiltro = (searchParams.status ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => STATUS_VALIDOS.has(s));
  if (statusFiltro.length > 0) {
    query = query.in("status_calculado", statusFiltro);
  }

  // Filtro por data de início do contrato (>= inicio_apos)
  const inicioApos = searchParams.inicio_apos?.trim();
  if (inicioApos && /^\d{4}-\d{2}-\d{2}$/.test(inicioApos)) {
    query = query.gte("data_inicio", inicioApos);
  }

  // Filtro por responsável do contrato
  const responsavelId = searchParams.responsavel?.trim();
  if (responsavelId && /^[0-9a-f-]{36}$/i.test(responsavelId)) {
    query = query.eq("responsavel_id", responsavelId);
  }

  // Filtro por card de análise (combina com os outros via AND)
  const cardFiltro = searchParams.card;
  if (cardFiltro && CARDS_VALIDOS.has(cardFiltro as CategoriaCard)) {
    if (cardFiltro === "na-ativa") {
      query = query.eq("status_real", true);
    } else if (cardFiltro === "em-dia") {
      query = query
        .eq("status_real", true)
        .in("status_calculado", ["regular", "vencendo"]);
    } else if (cardFiltro === "irregular") {
      query = query
        .eq("status_real", true)
        .in("status_calculado", [
          "irregular",
          "sem_minuta",
          "sem_assinado",
          "pendente",
        ]);
    } else if (cardFiltro === "encerrados") {
      // Qualquer um que não esteja trabalhando
      query = query.or("status_real.eq.false,status_calculado.eq.encerrado");
    }
  }

  // Totais dos 4 cards (independentes dos filtros atuais pra o usuário
  // ter sempre o retrato geral do tenant).
  const [freelancersRes, cargosRes, totaisRes] = await Promise.all([
    query.returns<FreelancerComStatus[]>(),
    supabase
      .from("freelancer_cargos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("nome", { ascending: true })
      .returns<FreelancerCargo[]>(),
    supabase
      .from("freelancers_com_status")
      .select("status_real, status_calculado")
      .eq("tenant_id", session.activeTenant.id),
  ]);

  if (freelancersRes.error) {
    console.error("[freelancers.lista]", freelancersRes.error.message);
  }
  if (cargosRes.error) {
    console.error("[freelancers.cargos]", cargosRes.error.message);
  }

  const freelancers = freelancersRes.data ?? [];
  const cargos = cargosRes.data ?? [];

  // Cálculo dos 4 cards de análise
  const totaisRaw =
    (totaisRes.data as Array<{
      status_real: boolean | null;
      status_calculado: string;
    }>) ?? [];
  const totais: Record<CategoriaCard, number> = {
    "na-ativa": 0,
    "em-dia": 0,
    irregular: 0,
    encerrados: 0,
  };
  for (const t of totaisRaw) {
    if (t.status_real === false || t.status_calculado === "encerrado") {
      totais.encerrados += 1;
      continue;
    }
    if (t.status_real === true) {
      totais["na-ativa"] += 1;
      if (
        t.status_calculado === "regular" ||
        t.status_calculado === "vencendo"
      ) {
        totais["em-dia"] += 1;
      } else if (
        ["irregular", "sem_minuta", "sem_assinado", "pendente"].includes(
          t.status_calculado,
        )
      ) {
        totais.irregular += 1;
      }
    }
  }

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
            <ExportarButton />
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

      <CardsAnalise totais={totais} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <BuscaInput />
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <ChipsStatus />
      </div>

      <ListaClient
        freelancers={freelancers}
        podeEditar={podeCriarFreelancer}
      />
    </div>
  );
}
