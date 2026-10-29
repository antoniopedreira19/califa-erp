import { notFound, redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import type {
  AppRole,
  FreelancerCargo,
  FreelancerContrato,
} from "@/lib/types";
import { ContratoForm } from "../_components/contrato-form";
import { BlocoArquivos } from "../_components/bloco-arquivos";
import { BlocoDistrato } from "../_components/bloco-distrato";
import { jobsProPickerDeFreelancer } from "@/lib/data/jobs-pro-picker-de-freelancer";

export const dynamic = "force-dynamic";

const PODE_EDITAR = new Set(["administrador", "rh", "financeiro"]);
const ROLES_RESPONSAVEL: AppRole[] = [
  "administrador",
  "rh",
  "financeiro",
  "gerente_producao",
  "produtor",
];

export default async function EditarContratoPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const { data: contratoRaw, error: contratoErr } = await supabase
    .from("freelancer_contratos")
    .select("*, freelancer:freelancers(id, nome_social, cpf)")
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (contratoErr) {
    console.error("[contrato.perfil]", contratoErr.message);
  }
  if (!contratoRaw) {
    notFound();
  }

  const freelancer = (contratoRaw as any).freelancer as {
    id: string;
    nome_social: string;
    cpf: string | null;
  } | null;
  if (!freelancer) notFound();

  const contrato = contratoRaw as FreelancerContrato;

  if (!PODE_EDITAR.has(session.activeRole)) {
    redirect(`/freelancers/${freelancer.id}?reason=sem_permissao_editar`);
  }

  const [jobsCarregados, respRes, cargosRes] = await Promise.all([
    jobsProPickerDeFreelancer(supabase, session.activeTenant.id),
    supabase
      .from("tenant_members")
      .select("role, user_id, profiles(id, nome, email)")
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

  const jobs = [...jobsCarregados];

  // Se o job original do contrato ficou fora do filtro (status cancelado,
  // interno arquivado, etc.), ainda assim mostra ele na lista pra edição
  // funcionar. Vale pros dois tipos: produção (`job_id`) e interno
  // (`job_interno_id`).
  if (contrato.job_id && !jobs.find((j) => j.id === contrato.job_id)) {
    jobs.unshift({
      id: contrato.job_id,
      codigo: "",
      nome: contrato.nome_job,
      origem: "producao",
    });
  }
  if (
    contrato.job_interno_id &&
    !jobs.find((j) => j.id === contrato.job_interno_id)
  ) {
    jobs.unshift({
      id: contrato.job_interno_id,
      codigo: "",
      nome: contrato.nome_job,
      origem: "interno",
    });
  }

  const responsaveis = (respRes.data ?? [])
    .map((m: any) => {
      const p = m.profiles;
      if (!p) return null;
      return {
        id: p.id as string,
        nome: p.nome as string,
        email: p.email as string,
        role: m.role as AppRole,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    nome: string;
    email: string;
    role: AppRole;
  }>;

  const cargos = cargosRes.data ?? [];

  const podeGerarMinuta = !!freelancer.nome_social && !!freelancer.cpf;
  const motivoBloqueioMinuta = podeGerarMinuta
    ? undefined
    : "Preencha pelo menos nome social e CPF do freelancer antes de gerar a minuta";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <BotaoVoltar
          reserva={`/freelancers/${freelancer.id}`}
          className="mb-3"
        />
        <PageHeader
          eyebrow="Freelancers"
          title={`Editar contrato · ${freelancer.nome_social}`}
          description="Atualize job, cargo, valor, período e responsável. Trocar o job atualiza o nome snapshot do contrato."
          icon={FileText}
        />
      </div>

      <BlocoArquivos
        contratoId={contrato.id}
        temMinuta={!!contrato.minuta_url}
        temAssinado={!!contrato.arquivo_url}
        podeGerenciar={PODE_EDITAR.has(session.activeRole)}
        podeGerarMinuta={podeGerarMinuta}
        motivoBloqueioMinuta={motivoBloqueioMinuta}
      />

      <BlocoDistrato
        contratoId={contrato.id}
        dataTerminoAtual={contrato.data_termino}
        distrato={{
          data_proposta: contrato.distrato_data_proposta,
          motivo: contrato.distrato_motivo,
          minuta_url: contrato.distrato_minuta_url,
          arquivo_url: contrato.distrato_arquivo_url,
          solicitado_em: contrato.distrato_solicitado_em,
        }}
        podeGerenciar={PODE_EDITAR.has(session.activeRole)}
      />

      <ContratoForm
        modo="editar"
        contrato={contrato}
        freelancer={freelancer}
        jobs={jobs}
        responsaveis={responsaveis}
        cargos={cargos}
      />
    </div>
  );
}
