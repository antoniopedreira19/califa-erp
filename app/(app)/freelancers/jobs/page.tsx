import { Briefcase } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listEmpresasAtivas } from "@/lib/data/empresas";
import { pode } from "@/lib/permissoes";
import { JOB_STATUS_ABERTO, jobStatusExibido } from "@/lib/types";
import type { FreelancerJobInterno } from "@/lib/types";
import {
  impedimentosDosJobs,
  podeEncerrar,
} from "@/lib/data/impedimentos-encerramento";
import { jobsComCancelamentoPendente } from "@/lib/data/cancelamentos";
import { projetosNaEquipeDe } from "@/lib/data/equipe-do-projeto";
import { JobsList, type JobRow } from "../../jobs/jobs-list";
import { PageHeader } from "@/components/ui/page-header";
import { AbasOrigem } from "./_components/abas-origem";
import { JobsInternosTabela } from "./_components/jobs-internos-tabela";

export const dynamic = "force-dynamic";

// Página de jobs da aba Freelancers. Duas origens:
//   `aba=producao` → espelho de /jobs (todos os jobs da tabela `jobs` que o
//                    usuário enxerga por RLS).
//   `aba=interno`  → CRUD dos jobs internos de freelancer (tabela
//                    `freelancer_jobs_internos`), que não existem no fluxo
//                    de orçamento/PP/faturamento.

const PODE_ESCREVER_INTERNO = new Set([
  "administrador",
  "rh",
  "financeiro",
]);

function motivoForaDoLote(r: any, cancelamentoPedido: boolean): string | null {
  if (!["aberto", "em_producao", "encerrado"].includes(r.status)) {
    return "Só job aberto ou encerrado vai para faturamento.";
  }
  if (cancelamentoPedido) return "Tem pedido de cancelamento no financeiro.";
  if (r.faturamento_enviado_em) return "Todo o faturamento dele já foi enviado.";
  if (!(Number(r.faturamento_previsto ?? 0) > 0.004)) return "Sem faturamento previsto.";
  return null;
}

export default async function FreelancersJobsPage({
  searchParams,
}: {
  searchParams?: {
    aba?: string;
    filtro?: string;
    empresa?: string;
    meus?: string;
  };
}) {
  const session = await requireSession();
  const supabase = createClient();
  const aba = searchParams?.aba === "interno" ? "interno" : "producao";

  // Contagem das duas origens em paralelo — pros pills ficarem sempre com
  // o número certo independentemente da aba selecionada.
  const [countProducaoRes, countInternoRes] = await Promise.all([
    supabase
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .neq("status", "cancelado"),
    supabase
      .from("freelancer_jobs_internos")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .is("arquivado_em", null),
  ]);

  const countProducao = countProducaoRes.count ?? 0;
  const countInterno = countInternoRes.count ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="FREELANCERS"
        title="Jobs"
        description="Jobs de produção (com orçamento, projeto e cliente) e jobs internos (rótulos pra agrupar freelancers sem fluxo financeiro)."
        icon={Briefcase}
      />

      <AbasOrigem countProducao={countProducao} countInterno={countInterno} />

      {aba === "producao" ? (
        <AbaProducao
          session={session}
          supabase={supabase}
          searchParams={searchParams}
        />
      ) : (
        <AbaInterno
          supabase={supabase}
          tenantId={session.activeTenant.id}
          podeEscrever={PODE_ESCREVER_INTERNO.has(session.activeRole)}
        />
      )}
    </div>
  );
}

async function AbaProducao({
  session,
  supabase,
  searchParams,
}: {
  session: Awaited<ReturnType<typeof requireSession>>;
  supabase: ReturnType<typeof createClient>;
  searchParams?: { filtro?: string; empresa?: string; meus?: string };
}) {
  const filtro =
    searchParams?.filtro === "faturamento_proximo" ||
    searchParams?.filtro === "faturamento_pronto"
      ? "faturamento_pendente"
      : searchParams?.filtro;

  const empresaFiltroIds: string[] =
    typeof searchParams?.empresa === "string" && searchParams.empresa.length > 0
      ? searchParams.empresa.split(",").filter((id) => id.length > 0)
      : session.activeEmpresas.map((e) => e.id);

  let jobIdsComPendencia: string[] | null = null;
  if (filtro === "realizado_pendente") {
    const { data: comPendencia } = await supabase
      .from("jobs_itens_realizado")
      .select("job_id")
      .eq("tenant_id", session.activeTenant.id)
      .is("total_realizado", null);
    const ids = Array.from(
      new Set(
        (comPendencia ?? [])
          .map((r: { job_id: string | null }) => r.job_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    jobIdsComPendencia = ids;
  }

  let jobsQuery = supabase
    .from("jobs")
    .select(
      "id, codigo, created_at, nome, status, faturamento_enviado_em, faturamento_previsto, valor_total, data_inicio_prevista, empresa_id, projeto_id, " +
        "produto, regional_id, responsavel_id, produtor_id, observacoes, " +
        "regional:regionais(nome), " +
        "cliente_id, cliente:clientes!jobs_cliente_id_fkey(nome_fantasia), projeto:projetos(codigo, nome, descricao), " +
        "responsavel:profiles!responsavel_id(nome), " +
        "empresa:empresas(id, razao_social, nome_fantasia)",
    )
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "cancelado")
    .order("created_at", { ascending: true });

  if (empresaFiltroIds.length > 0) {
    jobsQuery = jobsQuery.in("empresa_id", empresaFiltroIds);
  }

  if (filtro === "faturamento_pendente") {
    jobsQuery = jobsQuery
      .in("status", ["aberto", "em_producao", "encerrado"])
      .gt("faturamento_previsto", 0.004)
      .is("faturamento_enviado_em", null);
  } else if (filtro === "realizado_pendente") {
    if (jobIdsComPendencia !== null && jobIdsComPendencia.length === 0) {
      jobsQuery = jobsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    } else if (jobIdsComPendencia !== null && jobIdsComPendencia.length > 0) {
      jobsQuery = jobsQuery.in("id", jobIdsComPendencia);
    }
  }
  if (filtro === "encerrar_pronto") {
    jobsQuery = jobsQuery.in("status", JOB_STATUS_ABERTO);
  }

  const podeAlternarMeusTodos = pode(session.activeRole, "listas.chave_meus_todos");
  const podeEnviarFaturamento = pode(session.activeRole, "jobs.enviar_faturamento");

  const [jobsRes, empresas, comPedidoDeCancelamento, projetosDaMinhaEquipe] =
    await Promise.all([
      jobsQuery,
      listEmpresasAtivas(session.activeTenant.id),
      jobsComCancelamentoPendente(supabase, session.activeTenant.id),
      podeAlternarMeusTodos
        ? projetosNaEquipeDe(supabase, session.activeTenant.id, session.profile.id)
        : Promise.resolve(new Set<string>()),
    ]);

  if (jobsRes.error) console.error("[freelancers.jobs.list]", jobsRes.error.message);

  let linhas = (jobsRes.data ?? []) as any[];
  if (filtro === "encerrar_pronto" && linhas.length > 0) {
    const impedimentos = await impedimentosDosJobs(
      supabase,
      session.activeTenant.id,
      linhas.map((r) => r.id as string),
    );
    linhas = linhas.filter((r) => {
      const imp = impedimentos.get(r.id);
      return imp ? podeEncerrar(imp) : false;
    });
  }

  const rows: JobRow[] = linhas.map((r: any) => ({
    id: r.id,
    codigo: r.codigo,
    criado_em: r.created_at,
    nome: r.nome,
    status: jobStatusExibido(
      r.status,
      r.faturamento_enviado_em ?? null,
      comPedidoDeCancelamento.has(r.id),
    ),
    valor_total: r.valor_total !== null ? Number(r.valor_total) : null,
    data_inicio_prevista: r.data_inicio_prevista,
    projeto_id: r.projeto_id,
    produto: r.produto ?? null,
    regional_id: r.regional_id ?? null,
    regional_nome: r.regional?.nome ?? null,
    responsavel_id: r.responsavel_id ?? null,
    produtor_id: r.produtor_id ?? null,
    meu:
      r.responsavel_id === session.profile.id ||
      r.produtor_id === session.profile.id ||
      projetosDaMinhaEquipe.has(r.projeto_id),
    observacoes: r.observacoes ?? null,
    projeto_codigo: r.projeto?.codigo ?? null,
    projeto_nome: r.projeto?.nome ?? null,
    projeto_descricao: r.projeto?.descricao ?? null,
    cliente_nome: r.cliente?.nome_fantasia ?? null,
    responsavel_nome: r.responsavel?.nome ?? null,
    empresa_id: r.empresa_id ?? null,
    empresa_nome: r.empresa?.nome_fantasia ?? r.empresa?.razao_social ?? null,
    cliente_id: r.cliente_id ?? null,
    motivo_fora_do_lote: motivoForaDoLote(r, comPedidoDeCancelamento.has(r.id)),
  }));

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-12 shadow-soft text-center max-w-2xl mx-auto">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
          <Briefcase className="h-6 w-6" />
        </div>
        <h2 className="mt-6 text-xl font-semibold">Nenhum job de produção</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Os jobs de produção nascem a partir de orçamentos aprovados em
          /orcamentos.
        </p>
      </div>
    );
  }

  return (
    <JobsList
      rows={rows}
      empresas={empresas}
      podeAlternarMeusTodos={podeAlternarMeusTodos}
      meusInicial={
        podeAlternarMeusTodos && (searchParams?.meus === "1" || !filtro)
      }
      podeEnviarFaturamento={podeEnviarFaturamento}
    />
  );
}

async function AbaInterno({
  supabase,
  tenantId,
  podeEscrever,
}: {
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
  podeEscrever: boolean;
}) {
  // Ativos primeiro, depois arquivados — ambos aparecem (arquivado some do
  // picker, mas o CRUD mostra pra permitir desarquivar).
  const { data, error } = await supabase
    .from("freelancer_jobs_internos")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("arquivado_em", { ascending: true, nullsFirst: true })
    .order("codigo", { ascending: true });

  if (error) {
    console.error("[freelancers.jobs.internos]", error.message);
  }

  const jobs = (data ?? []) as FreelancerJobInterno[];

  return <JobsInternosTabela jobs={jobs} podeEscrever={podeEscrever} />;
}
