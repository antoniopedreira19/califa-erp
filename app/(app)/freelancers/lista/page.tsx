import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import type { FreelancerComStatus, FreelancerCargo } from "@/lib/types";
import { ListaClient } from "./_components/lista-client";
import { FiltrosDropdowns } from "./_components/filtros-dropdowns";
import { ChipsFiltros } from "./_components/chips-filtros";
import { GerenciarCargosDialog } from "./_components/gerenciar-cargos-dialog";
import { CardsAnalise, type CategoriaCard } from "./_components/cards-analise";
import { ExportarButton } from "./_components/exportar-button";
import { NovoFreelancerDialog } from "../_components/novo-freelancer-dialog";
import type { JobItem } from "../_components/job-picker";

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
    job?: string;
    cargo?: string;
    trabalho?: string;
  };
}) {
  const session = await requireSession();
  if (!pode(session.activeRole, "sidebar.freelancers")) {
    redirect("/home?reason=sem_permissao_freelancers");
  }

  const supabase = createClient();
  const APROVADORES_LISTA = new Set(["administrador", "rh", "financeiro"]);
  const isAprovador = APROVADORES_LISTA.has(session.activeRole);

  // Query principal consome a view `freelancers_com_status` — ela traz
  // cargo e status derivado do contrato ativo. GP/produtor vê só os freelas
  // dos quais é responsavel direto (freelancers.responsavel_id). Essa é a
  // fonte de verdade "dono da pessoa" — não some quando o contrato encerra.
  // RLS: policies `freelancers_select_responsavel_direto` +
  // `freelancers_select_responsavel_contrato` são ORed.
  let query = supabase
    .from("freelancers_com_status")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .order("nome_social", { ascending: true });
  if (!isAprovador) {
    query = query.eq("freela_responsavel_id", session.profile.id);
  }

  // Busca por nome/CPF é 100% client-side em `ListaClient` — sem round-trip
  // no servidor nem param na URL. Só os filtros que vêm dos dropdowns/chips
  // continuam sendo passados via query string (persistem link compartilhável).

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

  // Filtro por responsáveis (multi) — usa o dono da pessoa, não do contrato
  const responsavelFiltro = (searchParams.responsavel ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  if (responsavelFiltro.length > 0) {
    query = query.in("freela_responsavel_id", responsavelFiltro);
  }

  // Filtro por jobs (multi)
  const jobFiltro = (searchParams.job ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  if (jobFiltro.length > 0) {
    query = query.in("job_id", jobFiltro);
  }

  // Filtro por cargo do contrato (single)
  const cargoFiltro = searchParams.cargo?.trim();
  if (cargoFiltro) {
    query = query.eq("cargo_contrato", cargoFiltro);
  }

  // Filtro por status do trabalho (status_real)
  const trabalhoFiltro = searchParams.trabalho?.trim();
  if (trabalhoFiltro === "trabalhando") {
    query = query.eq("status_real", true);
  } else if (trabalhoFiltro === "inativo") {
    query = query.eq("status_real", false);
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
  // ter sempre o retrato geral do escopo visível — tenant pra aprovador,
  // só os próprios pra GP/produtor).
  let totaisQuery = supabase
    .from("freelancers_com_status")
    .select("status_real, status_calculado")
    .eq("tenant_id", session.activeTenant.id);
  if (!isAprovador) {
    totaisQuery = totaisQuery.eq("freela_responsavel_id", session.profile.id);
  }

  // Dados pro NovoFreelancerDialog (só carrega quando user pode criar).
  const JOBS_STATUS_EXCLUIDOS = ["cancelado", "rejeitado_financeiro"];

  const [freelancersRes, cargosRes, totaisRes, jobsNovoRes, responsaveisNovoRes] =
    await Promise.all([
      query.returns<FreelancerComStatus[]>(),
      supabase
        .from("freelancer_cargos")
        .select("*")
        .eq("tenant_id", session.activeTenant.id)
        .order("nome", { ascending: true })
        .returns<FreelancerCargo[]>(),
      totaisQuery,
      // Jobs ativos pro picker do Step 5 do dialog
      supabase
        .from("jobs")
        .select("id, codigo, nome, status")
        .eq("tenant_id", session.activeTenant.id)
        .not("status", "in", `(${JOBS_STATUS_EXCLUIDOS.join(",")})`)
        .order("codigo", { ascending: false })
        .limit(500),
      // Responsáveis (profiles ativos do tenant) pro combobox do Step 1
      supabase
        .from("profiles")
        .select("id, nome, tenant_members!inner(status, tenant_id)")
        .eq("ativo", true)
        .eq("tenant_members.tenant_id", session.activeTenant.id)
        .eq("tenant_members.status", "ativo")
        .order("nome", { ascending: true }),
    ]);

  if (freelancersRes.error) {
    console.error("[freelancers.lista]", freelancersRes.error.message);
  }
  if (cargosRes.error) {
    console.error("[freelancers.cargos]", cargosRes.error.message);
  }

  const freelancers = freelancersRes.data ?? [];
  const cargos = cargosRes.data ?? [];
  const jobsNovo: JobItem[] = (jobsNovoRes.data ?? []).map((j: any) => ({
    id: j.id as string,
    codigo: j.codigo as string,
    nome: j.nome as string,
  }));
  const responsaveisNovo = ((responsaveisNovoRes.data ?? []) as any[]).map(
    (r) => ({ id: r.id as string, nome: r.nome as string }),
  );

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

  // Listas únicas pros dropdowns de filtro. Também respeita o escopo visível
  // (aprovador vê catálogo completo; GP/produtor vê só o que apareceria
  // na própria lista — faz sentido o filtro só oferecer o que ele enxerga).
  let dropdownsQuery = supabase
    .from("freelancers_com_status")
    .select(
      "freela_responsavel_id, freela_responsavel_nome, job_id, job_codigo, job_nome, cargo_contrato",
    )
    .eq("tenant_id", session.activeTenant.id);
  if (!isAprovador) {
    dropdownsQuery = dropdownsQuery.eq(
      "freela_responsavel_id",
      session.profile.id,
    );
  }
  const { data: todosRows } = await dropdownsQuery;

  const responsaveisMap = new Map<string, string>();
  const jobsMap = new Map<string, string>();
  const cargosSet = new Set<string>();
  for (const r of (todosRows ?? []) as any[]) {
    if (r.freela_responsavel_id && r.freela_responsavel_nome) {
      responsaveisMap.set(r.freela_responsavel_id, r.freela_responsavel_nome);
    }
    if (r.job_id && r.job_nome) {
      jobsMap.set(
        r.job_id,
        r.job_codigo ? `${r.job_codigo} · ${r.job_nome}` : r.job_nome,
      );
    }
    if (r.cargo_contrato && r.cargo_contrato.trim() !== "") {
      cargosSet.add(r.cargo_contrato);
    }
  }
  const responsaveisDisponiveis = Array.from(responsaveisMap.entries())
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const jobsDisponiveis = Array.from(jobsMap.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const cargosDisponiveis = Array.from(cargosSet).sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <ExportarButton />
        {podeGerenciarCargos && (
          <Link
            href="/jobs"
            prefetch={false}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-colors"
          >
            <FolderKanban className="h-4 w-4" />
            Jobs
          </Link>
        )}
        {podeGerenciarCargos && <GerenciarCargosDialog cargos={cargos} />}
        {podeCriarFreelancer && (
          <NovoFreelancerDialog
            responsaveis={responsaveisNovo}
            jobs={jobsNovo}
            cargos={cargos}
          />
        )}
      </div>

      <CardsAnalise totais={totais} />

      <ListaClient
        freelancers={freelancers}
        podeEditar={podeCriarFreelancer}
        filtrosDropdowns={
          <FiltrosDropdowns
            responsaveisDisponiveis={responsaveisDisponiveis}
            jobsDisponiveis={jobsDisponiveis}
            cargosDisponiveis={cargosDisponiveis}
          />
        }
        chipsFiltros={<ChipsFiltros />}
      />
    </div>
  );
}
