import { redirect } from "next/navigation";
import { UserPlus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { FreelancerForm } from "../_components/freelancer-form";

export const dynamic = "force-dynamic";

const PODE_CRIAR = new Set(["administrador", "rh", "financeiro"]);

export default async function NovoFreelancerPage() {
  const session = await requireSession();
  if (!PODE_CRIAR.has(session.activeRole)) {
    redirect("/freelancers/lista?reason=sem_permissao_criar");
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <BotaoVoltar reserva="/freelancers/lista" className="mb-3" />
        <PageHeader
          eyebrow="Freelancers"
          title="Novo freelancer"
          description="Cadastro manual de pessoa. Para registrar um contrato com job, cargo e valor, vá até o perfil depois de salvar."
          icon={UserPlus}
        />
      </div>

      <FreelancerForm modo="novo" />
    </div>
  );
}
