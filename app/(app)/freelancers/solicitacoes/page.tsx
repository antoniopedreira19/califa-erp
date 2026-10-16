import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import { PageHeader } from "@/components/ui/page-header";
import type {
  FreelancerCargo,
  FreelancerSolicitacao,
} from "@/lib/types";
import { NovaSolicitacaoDialog } from "./_components/nova-solicitacao-dialog";
import { SolicitacoesTabela } from "./_components/solicitacoes-tabela";

export const dynamic = "force-dynamic";

const STATUS_VALIDOS = new Set([
  "pendente",
  "aprovada",
  "rejeitada",
  "cadastrada",
  "cancelada",
]);

const JOBS_STATUS_EXCLUIDOS = ["cancelado", "rejeitado_financeiro"];

export default async function SolicitacoesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string };
}) {
  const session = await requireSession();
  if (!pode(session.activeRole, "sidebar.freelancers")) {
    redirect("/home?reason=sem_permissao_freelancers");
  }

  const supabase = createClient();

  // Query da lista
  let query = supabase
    .from("freelancer_solicitacoes")
    .select(
      "*, solicitante:profiles!solicitante_id(nome, email), job:jobs(codigo, nome)",
    )
    .eq("tenant_id", session.activeTenant.id)
    .order("created_at", { ascending: false });

  const termo = searchParams.q?.trim();
  if (termo) {
    const soDigitos = termo.replace(/\D+/g, "");
    const likeNome = `%${termo}%`;
    const condicoes = [`nome_freela.ilike.${likeNome}`];
    if (soDigitos.length >= 3) {
      condicoes.push(`cpf_freela.ilike.%${soDigitos}%`);
    }
    query = query.or(condicoes.join(","));
  }

  const statusFiltro = (searchParams.status ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => STATUS_VALIDOS.has(s));
  if (statusFiltro.length > 0) {
    query = query.in("status", statusFiltro);
  }

  // Pre-load jobs e cargos pra Nova solicitação (reutilizável)
  const [solicitacoesRes, jobsRes, cargosRes, naoLidasRes] = await Promise.all([
    query,
    supabase
      .from("jobs")
      .select("id, codigo, nome, status")
      .eq("tenant_id", session.activeTenant.id)
      .not("status", "in", `(${JOBS_STATUS_EXCLUIDOS.join(",")})`)
      .order("codigo", { ascending: false })
      .limit(500),
    supabase
      .from("freelancer_cargos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome", { ascending: true })
      .returns<FreelancerCargo[]>(),
    supabase.rpc("get_freelancer_solicitacao_mensagens_nao_lidas"),
  ]);

  const solicitacoes = ((solicitacoesRes.data ?? []) as any[]).map((s) => ({
    ...(s as FreelancerSolicitacao),
    solicitante_nome: s.solicitante?.nome ?? null,
    solicitante_email: s.solicitante?.email ?? null,
    job_codigo: s.job?.codigo ?? null,
    job_nome: s.job?.nome ?? null,
  }));

  const jobs = (jobsRes.data ?? []).map((j: any) => ({
    id: j.id as string,
    codigo: j.codigo as string,
    nome: j.nome as string,
  }));

  const cargos = cargosRes.data ?? [];

  // Mapa de não lidas por solicitação (badge na tabela)
  const naoLidasMap: Record<string, number> = {};
  for (const linha of (naoLidasRes.data ?? []) as Array<{
    solicitacao_id: string;
    nao_lidas: number;
  }>) {
    naoLidasMap[linha.solicitacao_id] = Number(linha.nao_lidas);
  }

  // Resolver origin pro link público (fallback env)
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const publicOrigin = host ? `${proto}://${host}` : "";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Freelancers"
        title="Solicitações"
        description="Pedidos de contratação feitos pelos gerentes, aguardando aprovação do RH ou Financeiro."
        icon={ClipboardList}
        actions={<NovaSolicitacaoDialog jobs={jobs} cargos={cargos} />}
      />

      <SolicitacoesTabela
        solicitacoes={solicitacoes}
        activeRole={session.activeRole}
        userId={session.profile.id}
        publicOrigin={publicOrigin}
        naoLidasPorSolicitacao={naoLidasMap}
      />
    </div>
  );
}
