import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { FreelancerCargo } from "@/lib/types";
import { HeroDashboard } from "./_components/hero-dashboard";
import { CardsAnalise, type CategoriaCard } from "./lista/_components/cards-analise";
import { CardsAcoesPrevistas } from "./_components/cards-acoes-previstas";
import { CardSolicitacoes } from "./_components/card-solicitacoes";
import { GridNovosContratos } from "./_components/grid-novos-contratos";
import { BuscarFreelancerPill } from "./_components/buscar-freelancer-pill";
import { NovidadesPill } from "./_components/novidades-pill";
import type { FreelancerLookup } from "./_components/freelancer-picker-table";
import type { JobItem } from "./_components/job-picker";
import {
  TabelaPerformance,
  type PerformanceLinha,
} from "./_components/tabela-performance";
import {
  carregarNovidades,
  carregarFreelancersLookup,
} from "./_data/novidades";

export const dynamic = "force-dynamic";

const APROVADORES = new Set(["administrador", "rh", "financeiro"]);
const JOBS_STATUS_EXCLUIDOS = ["cancelado", "rejeitado_financeiro"];

export default async function FreelancersDashboardPage() {
  const session = await requireSession();
  const supabase = createClient();

  const isAprovador = APROVADORES.has(session.activeRole);

  // 1. Dados da view pro cálculo de análise + ações previstas + performance
  const viewRes = await supabase
    .from("freelancers_com_status")
    .select(
      "id, status_real, status_calculado, acao_prevista, data_inicio, responsavel_id, responsavel_nome",
    )
    .eq("tenant_id", session.activeTenant.id);

  const rows = (viewRes.data ?? []) as Array<{
    id: string;
    status_real: boolean | null;
    status_calculado: string;
    acao_prevista: string | null;
    data_inicio: string | null;
    responsavel_id: string | null;
    responsavel_nome: string | null;
  }>;

  // Totais dos 4 cards de análise
  const totaisAnalise: Record<CategoriaCard, number> = {
    "na-ativa": 0,
    "em-dia": 0,
    irregular: 0,
    encerrados: 0,
  };
  for (const r of rows) {
    if (r.status_real === false || r.status_calculado === "encerrado") {
      totaisAnalise.encerrados += 1;
      continue;
    }
    if (r.status_real === true) {
      totaisAnalise["na-ativa"] += 1;
      if (
        r.status_calculado === "regular" ||
        r.status_calculado === "vencendo"
      ) {
        totaisAnalise["em-dia"] += 1;
      } else if (
        ["irregular", "sem_minuta", "sem_assinado", "pendente"].includes(
          r.status_calculado,
        )
      ) {
        totaisAnalise.irregular += 1;
      }
    }
  }

  // Totais das 5 ações previstas
  const totaisAcoes = {
    contratar: 0,
    renovar: 0,
    manter: 0,
    substituir: 0,
    encerrar: 0,
  };
  for (const r of rows) {
    if (r.acao_prevista && r.acao_prevista in totaisAcoes) {
      totaisAcoes[r.acao_prevista as keyof typeof totaisAcoes] += 1;
    }
  }

  // Novos contratos por janela (data_inicio nos últimos N dias)
  const hoje = new Date();
  const diasAtras = (n: number) => {
    const d = new Date(hoje);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const limite = {
    "7d": diasAtras(7),
    "15d": diasAtras(15),
    "30d": diasAtras(30),
    "60d": diasAtras(60),
  };
  const totaisNovos = { "7d": 0, "15d": 0, "30d": 0, "60d": 0 } as Record<
    "7d" | "15d" | "30d" | "60d",
    number
  >;
  for (const r of rows) {
    if (!r.data_inicio) continue;
    if (r.data_inicio >= limite["7d"]) totaisNovos["7d"] += 1;
    if (r.data_inicio >= limite["15d"]) totaisNovos["15d"] += 1;
    if (r.data_inicio >= limite["30d"]) totaisNovos["30d"] += 1;
    if (r.data_inicio >= limite["60d"]) totaisNovos["60d"] += 1;
  }

  // Performance por responsável (só pra admin/rh/fin)
  const performance: PerformanceLinha[] = [];
  if (isAprovador) {
    const porResp = new Map<string, PerformanceLinha>();
    for (const r of rows) {
      if (!r.responsavel_id || !r.responsavel_nome) continue;
      if (!porResp.has(r.responsavel_id)) {
        porResp.set(r.responsavel_id, {
          responsavel_id: r.responsavel_id,
          nome: r.responsavel_nome,
          total: 0,
          regulares: 0,
          irregulares: 0,
          score: 0,
        });
      }
      const linha = porResp.get(r.responsavel_id)!;
      // Só conta ativos (status_real = true e status != encerrado)
      if (r.status_real !== true || r.status_calculado === "encerrado") continue;
      linha.total += 1;
      if (
        r.status_calculado === "regular" ||
        r.status_calculado === "vencendo"
      ) {
        linha.regulares += 1;
      } else if (
        ["irregular", "sem_minuta", "sem_assinado", "pendente"].includes(
          r.status_calculado,
        )
      ) {
        linha.irregulares += 1;
      }
    }
    for (const l of porResp.values()) {
      l.score =
        l.total > 0 ? Math.round((l.regulares / l.total) * 100) : 0;
    }
    performance.push(
      ...Array.from(porResp.values())
        .filter((l) => l.total > 0)
        .sort((a, b) => b.total - a.total),
    );
  }

  // Solicitações (modo pendentes p/ aprovador, minhas p/ demais)
  let solicitacoesQuery = supabase
    .from("freelancer_solicitacoes")
    .select(
      "id, nome_freela, cargo, status, created_at, solicitante_id, solicitante:profiles!solicitante_id(nome), job:jobs(nome)",
    )
    .eq("tenant_id", session.activeTenant.id)
    .order("created_at", { ascending: false })
    .limit(5);

  if (isAprovador) {
    solicitacoesQuery = solicitacoesQuery.eq("status", "pendente");
  } else {
    solicitacoesQuery = solicitacoesQuery.eq(
      "solicitante_id",
      session.profile.id,
    );
  }

  // Dados pros pills do hero (Buscar freelancer + Novidades)
  const [solRes, lookupData, novidadesData, jobsPillRes, cargosPillRes] =
    await Promise.all([
      solicitacoesQuery,
      carregarFreelancersLookup(supabase, session.activeTenant.id),
      isAprovador
        ? carregarNovidades(supabase, session.activeTenant.id)
        : Promise.resolve(null),
      // Jobs/cargos pro NovaSolicitacaoDialog quando GP clica no Buscar.
      // Aprovador vai pra /contratos/novo direto, não precisa.
      !isAprovador
        ? supabase
            .from("jobs")
            .select("id, codigo, nome, status")
            .eq("tenant_id", session.activeTenant.id)
            .not("status", "in", `(${JOBS_STATUS_EXCLUIDOS.join(",")})`)
            .order("codigo", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [] as any[] }),
      !isAprovador
        ? supabase
            .from("freelancer_cargos")
            .select("*")
            .eq("tenant_id", session.activeTenant.id)
            .eq("ativo", true)
            .order("nome", { ascending: true })
            .returns<FreelancerCargo[]>()
        : Promise.resolve({ data: [] as FreelancerCargo[] }),
    ]);

  const freelancersLookup = lookupData as FreelancerLookup[];
  const jobsPill: JobItem[] = (jobsPillRes.data ?? []).map((j: any) => ({
    id: j.id,
    codigo: j.codigo,
    nome: j.nome,
  }));
  const cargosPill = (cargosPillRes.data ?? []) as FreelancerCargo[];

  const solicitacoes = ((solRes.data ?? []) as any[]).map((s) => ({
    id: s.id as string,
    nome_freela: s.nome_freela as string,
    cargo: s.cargo as string | null,
    status: s.status as any,
    created_at: s.created_at as string,
    solicitante_nome: s.solicitante?.nome ?? null,
    job_nome: s.job?.nome ?? null,
  }));

  return (
    <div className="space-y-6">
      <HeroDashboard
        nomeUsuario={session.profile.nome}
        totalFreelancers={rows.length}
        totalIrregular={totaisAnalise.irregular}
        pills={
          <>
            <BuscarFreelancerPill
              freelancers={freelancersLookup}
              currentUserId={session.profile.id}
              isAprovador={isAprovador}
              jobs={jobsPill}
              cargos={cargosPill}
            />
            {isAprovador && novidadesData && (
              <NovidadesPill
                tenantId={session.activeTenant.id}
                novos={novidadesData.novos}
                aditivos={novidadesData.aditivos}
                preenchimentos={novidadesData.preenchimentos}
                distratos={novidadesData.distratos}
                concluidas={novidadesData.concluidas}
                dismissedIds={novidadesData.dismissedIds}
              />
            )}
          </>
        }
      />

      <CardsAnalise totais={totaisAnalise} />

      <CardsAcoesPrevistas totais={totaisAcoes} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <GridNovosContratos totais={totaisNovos} />
          {isAprovador && <TabelaPerformance linhas={performance} />}
        </div>
        <div>
          <CardSolicitacoes
            solicitacoes={solicitacoes}
            modo={isAprovador ? "pendentes" : "minhas"}
          />
        </div>
      </div>
    </div>
  );
}
