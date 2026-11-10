import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { FreelancerCargo } from "@/lib/types";
import { HeroDashboard } from "./_components/hero-dashboard";
import { CardsAnalise, type CategoriaCard } from "./lista/_components/cards-analise";
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
import { jobsProPickerDeFreelancer } from "@/lib/data/jobs-pro-picker-de-freelancer";

export const dynamic = "force-dynamic";

const APROVADORES = new Set(["administrador", "rh", "financeiro"]);

export default async function FreelancersDashboardPage() {
  const session = await requireSession();
  const supabase = createClient();

  const isAprovador = APROVADORES.has(session.activeRole);

  // 1. Dados da view pro cálculo de análise + performance.
  // GP/produtor vê só os freelas que ele é responsável (RLS do califa é frouxa
  // porque o Buscar freelancer precisa ver todos — filtro de escopo aqui).
  let viewQuery = supabase
    .from("freelancers_com_status")
    .select(
      "id, status_real, status_calculado, data_inicio, data_termino, responsavel_id, responsavel_nome",
    )
    .eq("tenant_id", session.activeTenant.id);
  if (!isAprovador) {
    viewQuery = viewQuery.eq("responsavel_id", session.profile.id);
  }
  const viewRes = await viewQuery;

  const rows = (viewRes.data ?? []) as Array<{
    id: string;
    status_real: boolean | null;
    status_calculado: string;
    data_inicio: string | null;
    data_termino: string | null;
    responsavel_id: string | null;
    responsavel_nome: string | null;
  }>;

  // Totais dos 4 cards de ação + subcontador "vence em 7 dias"
  const totaisAnalise: Record<Exclude<CategoriaCard, "vence-7d">, number> = {
    "em-dia": 0,
    vencidos: 0,
    "sem-assinado": 0,
    "sem-minuta": 0,
  };
  const hojeDash = new Date();
  const hojeDashISO = hojeDash.toISOString().slice(0, 10);
  const d7Dash = new Date(hojeDash);
  d7Dash.setDate(d7Dash.getDate() + 7);
  const d7DashISO = d7Dash.toISOString().slice(0, 10);
  let venceEm7DiasDash = 0;
  for (const r of rows) {
    if (r.status_real !== true || r.status_calculado === "encerrado") continue;
    if (r.status_calculado === "regular" || r.status_calculado === "vencendo") {
      totaisAnalise["em-dia"] += 1;
      if (
        r.data_termino &&
        r.data_termino >= hojeDashISO &&
        r.data_termino <= d7DashISO
      ) {
        venceEm7DiasDash += 1;
      }
    } else if (r.status_calculado === "irregular") {
      totaisAnalise.vencidos += 1;
    } else if (r.status_calculado === "sem_assinado") {
      totaisAnalise["sem-assinado"] += 1;
    } else if (r.status_calculado === "sem_minuta") {
      totaisAnalise["sem-minuta"] += 1;
    }
  }
  const totalAtividadeDash = rows.filter(
    (r) => r.status_real === true && r.status_calculado !== "encerrado",
  ).length;
  const totalPrecisaAtencao =
    totaisAnalise.vencidos +
    totaisAnalise["sem-assinado"] +
    totaisAnalise["sem-minuta"];

  // Saúde geral: % de ativos saudáveis. Aprovador vê todo o tenant;
  // GP/produtor vê só os freelas cujo contrato ativo tem ele como responsável.
  const rowsSaude = isAprovador
    ? rows
    : rows.filter((r) => r.responsavel_id === session.profile.id);
  let ativosSaude = 0;
  let saudaveisSaude = 0;
  for (const r of rowsSaude) {
    if (r.status_real !== true || r.status_calculado === "encerrado") continue;
    ativosSaude += 1;
    if (r.status_calculado === "regular" || r.status_calculado === "vencendo") {
      saudaveisSaude += 1;
    }
  }
  const saudePercentual =
    ativosSaude > 0 ? Math.round((saudaveisSaude / ativosSaude) * 100) : 100;

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
        .sort((a, b) => b.score - a.score || b.total - a.total),
    );
  }

  // Dados pros pills do hero (Buscar freelancer + Novidades). Fila de
  // solicitações pendentes mudou pra badge na tab de Solicitações (carregado
  // no layout.tsx).
  const [lookupData, novidadesData, jobsPill, cargosPillRes] =
    await Promise.all([
      carregarFreelancersLookup(supabase, session.activeTenant.id),
      isAprovador
        ? carregarNovidades(supabase, session.activeTenant.id)
        : Promise.resolve(null),
      // Jobs pro NovaSolicitacaoDialog — produção + internos ativos.
      jobsProPickerDeFreelancer(supabase, session.activeTenant.id),
      supabase
        .from("freelancer_cargos")
        .select("*")
        .eq("tenant_id", session.activeTenant.id)
        .eq("ativo", true)
        .order("nome", { ascending: true })
        .returns<FreelancerCargo[]>(),
    ]);

  const freelancersLookup = lookupData as FreelancerLookup[];
  const cargosPill = (cargosPillRes.data ?? []) as FreelancerCargo[];

  return (
    <div className="space-y-6">
      <HeroDashboard
        nomeUsuario={session.profile.nome}
        totalFreelancers={rows.length}
        totalIrregular={totalPrecisaAtencao}
        mostrarNovaSolicitacao
        saude={{
          percentual: saudePercentual,
          saudaveis: saudaveisSaude,
          ativos: ativosSaude,
          escopo: isAprovador ? "tenant" : "meus",
        }}
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
                distratos={novidadesData.distratos}
                distratosAguardandoAssinatura={
                  novidadesData.distratos_aguardando_assinatura
                }
                contratacoes={novidadesData.contratacoes}
                renovacoes={novidadesData.renovacoes}
                dismissedIds={novidadesData.dismissedIds}
              />
            )}
          </>
        }
      />

      <CardsAnalise
        totais={totaisAnalise}
        venceEm7Dias={venceEm7DiasDash}
        totalEmAtividade={totalAtividadeDash}
      />

      {isAprovador && performance.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2">
            <TabelaPerformance linhas={performance} />
          </div>
          <div>
            <GridNovosContratos totais={totaisNovos} orientacao="vertical" />
          </div>
        </div>
      ) : (
        <GridNovosContratos totais={totaisNovos} />
      )}
    </div>
  );
}
