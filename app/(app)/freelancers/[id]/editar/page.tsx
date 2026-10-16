import { notFound, redirect } from "next/navigation";
import { Edit2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Freelancer } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { FreelancerForm } from "../../_components/freelancer-form";

export const dynamic = "force-dynamic";

const PODE_EDITAR = new Set(["administrador", "rh", "financeiro"]);

export default async function EditarFreelancerPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  if (!PODE_EDITAR.has(session.activeRole)) {
    redirect(`/freelancers/${params.id}?reason=sem_permissao_editar`);
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("freelancers")
    .select("*")
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  const freelancer = data as Freelancer | null;

  if (error) {
    console.error("[freelancer.editar]", error.message);
  }
  if (!freelancer) {
    notFound();
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <BotaoVoltar reserva={`/freelancers/${freelancer.id}`} className="mb-3" />
        <PageHeader
          eyebrow="Freelancers"
          title={`Editar ${freelancer.nome_social}`}
          description="Atualize os dados pessoais, de endereço, PJ, pagamento e preferências."
          icon={Edit2}
        />
      </div>

      <FreelancerForm modo="editar" freelancer={freelancer} />
    </div>
  );
}
