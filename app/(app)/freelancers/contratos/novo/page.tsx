import { notFound, redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import type {
  AppRole,
  Freelancer,
  FreelancerCargo,
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
  searchParams: { freelancer?: string };
}) {
  const session = await requireSession();
  if (!PODE_CRIAR.has(session.activeRole)) {
    redirect("/freelancers/lista?reason=sem_permissao_criar_contrato");
  }

  const freelancerId = searchParams.freelancer;
  if (!freelancerId) {
    // Sem freelancer na URL, cadastro de contrato não começa.
    // Fase futura pode adicionar picker aqui; por ora manda pra lista.
    redirect("/freelancers/lista?reason=escolha_freelancer_antes");
  }

  const supabase = createClient();
  const [freelancerRes, jobs, respRes, cargosRes] = await Promise.all([
    supabase
      .from("freelancers")
      .select("id, nome_social")
      .eq("id", freelancerId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
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

  const freelancer = freelancerRes.data as
    | { id: string; nome_social: string }
    | null;
  if (!freelancer) {
    notFound();
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
          description="Vincule o freelancer a um job real do califa-erp. O nome do job é guardado como snapshot do momento do cadastro."
          icon={FileText}
        />
      </div>

      <ContratoForm
        modo="novo"
        freelancer={freelancer}
        jobs={jobs}
        responsaveis={responsaveis}
        cargos={cargos}
      />
    </div>
  );
}
