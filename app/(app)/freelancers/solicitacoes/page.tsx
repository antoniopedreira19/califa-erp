import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import type {
  FreelancerCargo,
  FreelancerSolicitacao,
} from "@/lib/types";
import { NovaSolicitacaoDialog } from "./_components/nova-solicitacao-dialog";
import { SolicitacoesTabela } from "./_components/solicitacoes-tabela";
import { jobsProPickerDeFreelancer } from "@/lib/data/jobs-pro-picker-de-freelancer";

export const dynamic = "force-dynamic";

const STATUS_VALIDOS = new Set([
  "pendente",
  "aprovada",
  "rejeitada",
  "cadastrada",
  "cancelada",
]);

const TIPOS_SOLICITACAO = new Set(["contratacao", "renovacao"]);

export default async function SolicitacoesPage({
  searchParams,
}: {
  searchParams: {
    q?: string;
    status?: string;
    tipo?: string;
    solicitante?: string;
    cargo?: string;
    job?: string;
  };
}) {
  const session = await requireSession();
  if (!pode(session.activeRole, "sidebar.freelancers")) {
    redirect("/home?reason=sem_permissao_freelancers");
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // Query da lista (sem order — a ordenação é client-side por prioridade de status)
  // Embed polimórfico: solicitação aponta pra `job` (produção) OU
  // `job_interno` (interno). O JS faz o COALESCE abaixo.
  let query = supabase
    .from("freelancer_solicitacoes")
    .select(
      "*, solicitante:profiles!solicitante_id(nome, email), job:jobs(codigo, nome), job_interno:freelancer_jobs_internos(nome)",
    )
    .eq("tenant_id", tenantId);

  // Busca por nome/CPF/cargo/solicitante é 100% client-side no componente
  // SolicitacoesTabela — sem round-trip nem param na URL.

  const statusFiltro = (searchParams.status ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => STATUS_VALIDOS.has(s));
  if (statusFiltro.length > 0) {
    query = query.in("status", statusFiltro);
  }

  const solicitanteFiltro = (searchParams.solicitante ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  if (solicitanteFiltro.length > 0) {
    query = query.in("solicitante_id", solicitanteFiltro);
  }

  const cargoFiltro = searchParams.cargo?.trim();
  if (cargoFiltro) {
    query = query.eq("cargo", cargoFiltro);
  }

  const jobFiltro = (searchParams.job ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  if (jobFiltro.length > 0) {
    // O dropdown não distingue origem; o id é único na raiz da sua tabela.
    // Casa com qualquer uma das duas colunas.
    const inList = jobFiltro.join(",");
    query = query.or(
      `job_id.in.(${inList}),job_interno_id.in.(${inList})`,
    );
  }

  const tipoFiltro = (searchParams.tipo ?? "").trim();
  const tipoFiltroValido = TIPOS_SOLICITACAO.has(tipoFiltro) ? tipoFiltro : "";

  // Pre-load jobs, cargos, não lidas, contagens globais (independentes dos
  // filtros atuais — alimentam os KPI cards do topo pro usuário ter sempre o
  // retrato geral).
  const [
    solicitacoesRes,
    jobs,
    cargosRes,
    naoLidasRes,
    contagensRes,
    todosSolicitantesRes,
  ] = await Promise.all([
    query,
    jobsProPickerDeFreelancer(supabase, tenantId),
    supabase
      .from("freelancer_cargos")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("nome", { ascending: true })
      .returns<FreelancerCargo[]>(),
    supabase.rpc("get_freelancer_solicitacao_mensagens_nao_lidas"),
    supabase
      .from("freelancer_solicitacoes")
      .select("status")
      .eq("tenant_id", tenantId),
    // Lista única de solicitantes (pra filtro). Admin vê todos, GP só a si
    // mesmo (via RLS). Query separada do join principal pra evitar explosão
    // de linhas duplicadas.
    supabase
      .from("freelancer_solicitacoes")
      .select("solicitante_id, solicitante:profiles!solicitante_id(nome)")
      .eq("tenant_id", tenantId),
  ]);

  if (solicitacoesRes.error) {
    console.error("[solicitacoes.list]", solicitacoesRes.error.message, solicitacoesRes.error);
  }

  // Calcula tipo_solicitacao (contratacao/renovacao) a partir dos contratos
  // efetivos de cada freelancer. "Efetivo" = tem nome_job preenchido.
  const freelancerIdsNaLista = Array.from(
    new Set(
      (solicitacoesRes.data ?? [])
        .map((s: any) => s.freelancer_id)
        .filter((id: string | null): id is string => !!id),
    ),
  );
  const contratosPorFreela = new Map<string, number>();
  const nomeCompletoPorFreela = new Map<string, string>();
  if (freelancerIdsNaLista.length > 0) {
    const [contratosEfRes, nomesRes] = await Promise.all([
      supabase
        .from("freelancer_contratos")
        .select("freelancer_id")
        .eq("tenant_id", tenantId)
        .in("freelancer_id", freelancerIdsNaLista)
        .not("nome_job", "is", null),
      supabase
        .from("freelancers")
        .select("id, nome_completo, nome_social")
        .eq("tenant_id", tenantId)
        .in("id", freelancerIdsNaLista),
    ]);
    for (const r of (contratosEfRes.data ?? []) as Array<{ freelancer_id: string }>) {
      contratosPorFreela.set(
        r.freelancer_id,
        (contratosPorFreela.get(r.freelancer_id) ?? 0) + 1,
      );
    }
    for (const r of (nomesRes.data ?? []) as Array<{
      id: string;
      nome_completo: string | null;
      nome_social: string | null;
    }>) {
      const nome = r.nome_completo?.trim() || r.nome_social?.trim() || null;
      if (nome) nomeCompletoPorFreela.set(r.id, nome);
    }
  }

  const solicitacoes = ((solicitacoesRes.data ?? []) as any[]).map((s) => {
    let tipo_solicitacao: "contratacao" | "renovacao" = "contratacao";
    if (s.freelancer_id) {
      const total = contratosPorFreela.get(s.freelancer_id) ?? 0;
      // Se a solicitação já virou contrato, desconta ele mesmo pra não contar
      // como "contrato anterior".
      const anteriores = s.contrato_id ? total - 1 : total;
      if (anteriores > 0) tipo_solicitacao = "renovacao";
    }
    const nomeCompleto = s.freelancer_id
      ? (nomeCompletoPorFreela.get(s.freelancer_id) ?? null)
      : null;
    return {
      ...(s as FreelancerSolicitacao),
      // Prefere nome_completo do cadastro quando a solicitação já está vinculada
      // a um freelancer; cai no texto da solicitação (nome_freela) pra legados.
      nome_freela_display: nomeCompleto ?? s.nome_freela,
      solicitante_nome: s.solicitante?.nome ?? null,
      solicitante_email: s.solicitante?.email ?? null,
      // COALESCE das duas fontes: produção → `job`, interno → `job_interno`.
      // Internos não têm código. Fallback pro texto preservado das solicitações
      // legadas do RH antigo (job_id null, mas `nome_job` traz o nome).
      job_codigo: s.job?.codigo ?? null,
      job_nome: s.job?.nome ?? s.job_interno?.nome ?? s.nome_job ?? null,
      tipo_solicitacao,
    };
  });

  const cargos = cargosRes.data ?? [];

  const naoLidasMap: Record<string, number> = {};
  for (const linha of (naoLidasRes.data ?? []) as Array<{
    solicitacao_id: string;
    nao_lidas: number;
  }>) {
    naoLidasMap[linha.solicitacao_id] = Number(linha.nao_lidas);
  }

  // Contagens globais por status
  const contagens: Record<string, number> = {
    pendente: 0,
    aprovada: 0,
    cadastrada: 0,
    rejeitada: 0,
    cancelada: 0,
  };
  for (const r of (contagensRes.data ?? []) as Array<{ status: string }>) {
    if (r.status in contagens) contagens[r.status] += 1;
  }
  const totalContagem = Object.values(contagens).reduce((a, b) => a + b, 0);

  // Lista única de solicitantes (pra popular o filtro)
  const solicitantesMap = new Map<string, string>();
  for (const r of (todosSolicitantesRes.data ?? []) as Array<{
    solicitante_id: string;
    solicitante: { nome: string } | { nome: string }[] | null;
  }>) {
    if (!r.solicitante_id) continue;
    const nome = Array.isArray(r.solicitante)
      ? r.solicitante[0]?.nome
      : r.solicitante?.nome;
    if (nome) solicitantesMap.set(r.solicitante_id, nome);
  }
  const solicitantesDisponiveis = Array.from(solicitantesMap.entries())
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  // Listas pros filtros vêm do catálogo completo do tenant (jobs ativos e
  // freelancer_cargos ativos), não só das solicitações carregadas — assim o
  // dropdown aparece mesmo quando não há solicitação nenhuma, e o usuário vê
  // o universo possível de filtro.
  const cargosDisponiveis = cargos
    .map((c) => c.nome)
    .filter((c): c is string => !!c && c.trim() !== "")
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  const jobsDisponiveis = jobs
    .map((j) => ({
      id: j.id,
      label: j.codigo ? `${j.codigo} · ${j.nome}` : j.nome,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));


  // Resolver origin pro link público (fallback env)
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const publicOrigin = host ? `${proto}://${host}` : "";

  return (
    <div className="space-y-6">
      <SolicitacoesTabela
        solicitacoes={solicitacoes}
        contagens={contagens}
        totalContagem={totalContagem}
        solicitantesDisponiveis={solicitantesDisponiveis}
        cargosDisponiveis={cargosDisponiveis}
        jobsDisponiveis={jobsDisponiveis}
        tipoFiltroAtual={tipoFiltroValido}
        activeRole={session.activeRole}
        userId={session.profile.id}
        publicOrigin={publicOrigin}
        naoLidasPorSolicitacao={naoLidasMap}
        actions={<NovaSolicitacaoDialog jobs={jobs} cargos={cargos} />}
      />
    </div>
  );
}
