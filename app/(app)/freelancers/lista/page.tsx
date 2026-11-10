import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import type { FreelancerComStatus, FreelancerCargo } from "@/lib/types";
import { ListaClient } from "./_components/lista-client";
import { FiltrosDropdowns } from "./_components/filtros-dropdowns";
import { GerenciarCargosDialog } from "./_components/gerenciar-cargos-dialog";
import { CardsAnalise, type CategoriaCard } from "./_components/cards-analise";
import { ExportarButton } from "./_components/exportar-button";
import { NovoFreelancerDialog } from "../_components/novo-freelancer-dialog";
import { jobsProPickerDeFreelancer } from "@/lib/data/jobs-pro-picker-de-freelancer";

export const dynamic = "force-dynamic";

const CARDS_VALIDOS = new Set<CategoriaCard>([
  "em-dia",
  "vencidos",
  "sem-assinado",
  "sem-minuta",
  "vence-7d",
]);

export default async function FreelancersListaPage({
  searchParams,
}: {
  searchParams: {
    q?: string;
    card?: string;
    inicio_apos?: string;
    responsavel?: string;
    job?: string;
    cargo?: string;
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
  // no servidor nem param na URL. Só os filtros que vêm dos dropdowns +
  // card ativo continuam sendo passados via query string (link compartilhável).

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

  // Filtro por card de ação (combina com os outros via AND). Cada card
  // representa uma ação concreta a tomar; não existe card de "encerrados"
  // porque a tela é sobre quem precisa de atenção, não sobre histórico.
  const cardFiltro = searchParams.card;
  const hoje = new Date();
  const hojeISO = hoje.toISOString().slice(0, 10);
  const d7 = new Date(hoje);
  d7.setDate(d7.getDate() + 7);
  const d7ISO = d7.toISOString().slice(0, 10);
  if (cardFiltro && CARDS_VALIDOS.has(cardFiltro as CategoriaCard)) {
    if (cardFiltro === "em-dia") {
      query = query
        .eq("status_real", true)
        .in("status_calculado", ["regular", "vencendo"]);
    } else if (cardFiltro === "vencidos") {
      query = query
        .eq("status_real", true)
        .eq("status_calculado", "irregular");
    } else if (cardFiltro === "sem-assinado") {
      query = query
        .eq("status_real", true)
        .eq("status_calculado", "sem_assinado");
    } else if (cardFiltro === "sem-minuta") {
      query = query
        .eq("status_real", true)
        .eq("status_calculado", "sem_minuta");
    } else if (cardFiltro === "vence-7d") {
      // Subconjunto de "em dia" que vence nos proximos 7 dias — alerta
      // de acao rapida.
      query = query
        .eq("status_real", true)
        .in("status_calculado", ["regular", "vencendo"])
        .gte("data_termino", hojeISO)
        .lte("data_termino", d7ISO);
    }
  }

  // Totais dos 4 cards + contador "vence em 7 dias" (independentes dos
  // filtros atuais pra o usuário ter sempre o retrato geral do escopo
  // visível — tenant pra aprovador, só os próprios pra GP/produtor).
  let totaisQuery = supabase
    .from("freelancers_com_status")
    .select("status_real, status_calculado, data_termino")
    .eq("tenant_id", session.activeTenant.id);
  if (!isAprovador) {
    totaisQuery = totaisQuery.eq("freela_responsavel_id", session.profile.id);
  }

  // Dados pro NovoFreelancerDialog (só carrega quando user pode criar).

  const [freelancersRes, cargosRes, totaisRes, jobsNovo, responsaveisNovoRes] =
    await Promise.all([
      query.returns<FreelancerComStatus[]>(),
      supabase
        .from("freelancer_cargos")
        .select("*")
        .eq("tenant_id", session.activeTenant.id)
        .order("nome", { ascending: true })
        .returns<FreelancerCargo[]>(),
      totaisQuery,
      // Jobs pro picker do Step 5 do dialog — produção + internos ativos.
      jobsProPickerDeFreelancer(supabase, session.activeTenant.id),
      // Responsáveis (profiles ativos do tenant) pro combobox do Step 1.
      // PostgREST não resolve embed profiles ↔ tenant_members (as duas
      // apontam pra auth.users, sem FK direta — PGRST200). Puxa membership
      // e profiles separados e intersecta abaixo.
      supabase
        .from("tenant_members")
        .select("user_id")
        .eq("tenant_id", session.activeTenant.id)
        .eq("status", "ativo"),
    ]);

  const idsDoTenant = Array.from(
    new Set(
      ((responsaveisNovoRes.data ?? []) as Array<{ user_id: string }>).map(
        (r) => r.user_id,
      ),
    ),
  );
  const responsaveisProfilesRes =
    idsDoTenant.length > 0
      ? await supabase
          .from("profiles")
          .select("id, nome")
          .eq("ativo", true)
          .in("id", idsDoTenant)
          .order("nome", { ascending: true })
      : { data: [], error: null };

  if (freelancersRes.error) {
    console.error("[freelancers.lista]", freelancersRes.error.message);
  }
  if (cargosRes.error) {
    console.error("[freelancers.cargos]", cargosRes.error.message);
  }

  // DEBUG temporario — pra investigar caso Carol/GP ver menos freelas do que o
  // SQL direto mostra. Remover quando confirmado.
  console.log("[DEBUG.freelancers.lista]", {
    profile_id: session.profile.id,
    role: session.activeRole,
    isAprovador,
    searchParams,
    freelancersRes_count: freelancersRes.data?.length ?? 0,
    freelancersRes_error: freelancersRes.error?.message ?? null,
    totaisRes_count: totaisRes.data?.length ?? 0,
    totaisRes_error: totaisRes.error?.message ?? null,
  });

  const freelancers = freelancersRes.data ?? [];
  const cargos = cargosRes.data ?? [];
  const responsaveisNovo = (
    (responsaveisProfilesRes.data ?? []) as Array<{ id: string; nome: string }>
  ).map((r) => ({ id: r.id, nome: r.nome }));

  // Cálculo dos 4 cards de ação + subcontador "vence em 7 dias"
  const totaisRaw =
    (totaisRes.data as Array<{
      status_real: boolean | null;
      status_calculado: string;
      data_termino: string | null;
    }>) ?? [];
  const totais: Record<Exclude<CategoriaCard, "vence-7d">, number> = {
    "em-dia": 0,
    vencidos: 0,
    "sem-assinado": 0,
    "sem-minuta": 0,
  };
  let venceEm7Dias = 0;
  const totalEmAtividade = totaisRaw.filter(
    (t) => t.status_real === true && t.status_calculado !== "encerrado",
  ).length;
  for (const t of totaisRaw) {
    if (t.status_real !== true || t.status_calculado === "encerrado") continue;
    if (t.status_calculado === "regular" || t.status_calculado === "vencendo") {
      totais["em-dia"] += 1;
      if (t.data_termino && t.data_termino >= hojeISO && t.data_termino <= d7ISO) {
        venceEm7Dias += 1;
      }
    } else if (t.status_calculado === "irregular") {
      totais.vencidos += 1;
    } else if (t.status_calculado === "sem_assinado") {
      totais["sem-assinado"] += 1;
    } else if (t.status_calculado === "sem_minuta") {
      totais["sem-minuta"] += 1;
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
            href="/freelancers/jobs"
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

      <CardsAnalise
        totais={totais}
        venceEm7Dias={venceEm7Dias}
        totalEmAtividade={totalEmAtividade}
      />

      <ListaClient
        freelancers={freelancers}
        filtrosDropdowns={
          <FiltrosDropdowns
            responsaveisDisponiveis={responsaveisDisponiveis}
            jobsDisponiveis={jobsDisponiveis}
            cargosDisponiveis={cargosDisponiveis}
          />
        }
      />
    </div>
  );
}
