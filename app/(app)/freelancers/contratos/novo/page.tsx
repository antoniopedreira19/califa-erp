import { notFound, redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import type {
  AppRole,
  FreelancerCargo,
  FreelancerSolicitacao,
  FreelancerContrato,
} from "@/lib/types";
import { ContratoForm } from "../_components/contrato-form";
import { jobsProPickerDeFreelancer } from "@/lib/data/jobs-pro-picker-de-freelancer";

export const dynamic = "force-dynamic";

const PODE_CRIAR = new Set(["administrador", "rh", "financeiro"]);
const ROLES_RESPONSAVEL: AppRole[] = [
  "administrador",
  "rh",
  "financeiro",
  "gerente_producao",
  "produtor",
];

export default async function NovoContratoPage({
  searchParams,
}: {
  searchParams: { freelancer?: string; from_solicitacao?: string };
}) {
  const session = await requireSession();
  if (!PODE_CRIAR.has(session.activeRole)) {
    redirect("/freelancers/lista?reason=sem_permissao_criar_contrato");
  }

  const supabase = createClient();

  // Modo "a partir de solicitação": carrega a solicitação, deriva o
  // freelancer e usa os campos dela pra pré-preencher o form. Fecha o
  // buraco das renovações aprovadas que ficavam presas sem caminho pra
  // virar contrato (a solicitação é marcada como cadastrada só quando o
  // form é salvo, na action).
  let solicitacao: FreelancerSolicitacao | null = null;
  let freelancerId = searchParams.freelancer ?? null;
  if (searchParams.from_solicitacao) {
    const { data: solRaw } = await supabase
      .from("freelancer_solicitacoes")
      .select("*")
      .eq("id", searchParams.from_solicitacao)
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "aprovada")
      .not("freelancer_id", "is", null)
      .maybeSingle();
    if (!solRaw) {
      // Expirou, foi cancelada, não é renovação (sem freelancer_id) ou
      // é de outro tenant — manda pra lista de solicitações pra ação
      // apropriada.
      redirect("/freelancers/solicitacoes?reason=solicitacao_invalida");
    }
    solicitacao = solRaw as FreelancerSolicitacao;
    freelancerId = solicitacao.freelancer_id;
  }

  if (!freelancerId) {
    redirect("/freelancers/lista?reason=escolha_freelancer_antes");
  }

  const [freelancerRes, jobs, membrosRes, cargosRes] = await Promise.all([
    supabase
      .from("freelancers")
      .select("id, nome_social, responsavel_id")
      .eq("id", freelancerId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    jobsProPickerDeFreelancer(supabase, session.activeTenant.id),
    // Em 2 etapas (ver page do perfil + edit page): o embed `profiles(...)`
    // em `tenant_members` retorna null porque a FK aponta pra auth.users,
    // não pra public.profiles.
    supabase
      .from("tenant_members")
      .select("role, user_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .in("role", ROLES_RESPONSAVEL),
    supabase
      .from("freelancer_cargos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("nome", { ascending: true })
      .returns<FreelancerCargo[]>(),
  ]);

  const freelancer = freelancerRes.data as
    | { id: string; nome_social: string; responsavel_id: string | null }
    | null;
  if (!freelancer) {
    notFound();
  }

  const membros = (membrosRes.data ?? []) as Array<{
    role: AppRole;
    user_id: string;
  }>;
  const roleByUser = new Map<string, AppRole>(
    membros.map((m) => [m.user_id, m.role]),
  );
  const userIds = Array.from(new Set(membros.map((m) => m.user_id)));
  const profilesRes =
    userIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, nome, email")
          .in("id", userIds)
          .eq("ativo", true)
          .order("nome", { ascending: true })
      : { data: [], error: null };

  const responsaveis = ((profilesRes.data ?? []) as Array<{
    id: string;
    nome: string;
    email: string | null;
  }>).map((p) => ({
    id: p.id,
    nome: p.nome,
    email: p.email ?? "",
    role: roleByUser.get(p.id) ?? ("produtor" as AppRole),
  }));

  const cargos = cargosRes.data ?? [];

  // Pré-preenchimento quando vindo de solicitação: monta um objeto no
  // formato esperado pelo ContratoForm (FreelancerContrato parcial com os
  // campos editáveis — origem_sistema fica 'califa_erp' pra validar como
  // novo e exigir job).
  let contratoInicial: FreelancerContrato | undefined;
  if (solicitacao) {
    contratoInicial = {
      id: "",
      tenant_id: session.activeTenant.id,
      freelancer_id: freelancer.id,
      job_id: solicitacao.job_id,
      job_interno_id: solicitacao.job_interno_id,
      responsavel_id: freelancer.responsavel_id ?? solicitacao.solicitante_id,
      nome_job: solicitacao.nome_job ?? "",
      cargo: solicitacao.cargo,
      tipo: solicitacao.tipo,
      valor: solicitacao.valor,
      data_inicio: solicitacao.data_inicio,
      data_termino: solicitacao.data_termino,
      cidade: solicitacao.cidade,
      observacoes: solicitacao.observacoes,
      status_real: true,
      arquivo_url: null,
      minuta_url: null,
      data_termino_original: null,
      distrato_minuta_url: null,
      distrato_arquivo_url: null,
      distrato_data_proposta: null,
      distrato_motivo: null,
      distrato_solicitado_em: null,
      distrato_solicitado_por: null,
      origem_sistema: "califa_erp",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: null,
      updated_by: null,
    };
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <BotaoVoltar
          reserva={`/freelancers/${freelancer.id}`}
          className="mb-3"
        />
        <PageHeader
          eyebrow="Freelancers"
          title={`Novo contrato · ${freelancer.nome_social}`}
          description={
            solicitacao
              ? "Dados vindos da solicitação de renovação aprovada. Confira, ajuste se precisar e salve — a solicitação será fechada automaticamente."
              : "Vincule o freelancer a um job real do califa-erp. O nome do job é guardado como snapshot do momento do cadastro."
          }
          icon={FileText}
        />
      </div>

      <ContratoForm
        modo="novo"
        contrato={contratoInicial}
        solicitacaoId={solicitacao?.id ?? null}
        freelancer={freelancer}
        jobs={jobs}
        responsaveis={responsaveis}
        cargos={cargos}
      />
    </div>
  );
}
