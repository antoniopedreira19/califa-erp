import { redirect } from "next/navigation";
import { Scale } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { carregarCadastroFiscal } from "@/lib/fiscal/cadastro";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import type { EmpresaContabil } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { CadastroImpostos, type EmpresaDoCadastro } from "./cadastro-impostos";

export const dynamic = "force-dynamic";

/**
 * Cadastros do Financeiro › Impostos (módulo fiscal, entrega 1 — 02/10/2026):
 * a planilha de impostos dentro do sistema. CNPJs emissores, CNAEs e
 * alíquotas com vigência, vencimentos, feriados e parâmetros — o Faturar, a
 * aprovação da PP e a Apuração leem daqui.
 */
export default async function ImpostosPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();
  // As duas em paralelo, nunca em série (docs/PERFORMANCE.md).
  const [cadastro, empresasRes] = await Promise.all([
    carregarCadastroFiscal(supabase, session.activeTenant.id),
    supabase
      .from("empresas_contabeis")
      .select("id, razao_social, nome_fantasia, cnpj, ativo")
      .eq("tenant_id", session.activeTenant.id)
      .returns<Pick<EmpresaContabil, "id" | "razao_social" | "nome_fantasia" | "cnpj" | "ativo">[]>(),
  ]);
  if (empresasRes.error) console.error("[fiscal.impostos.empresas]", empresasRes.error.message);

  const empresas: EmpresaDoCadastro[] = (empresasRes.data ?? []).map((e) => ({
    id: e.id,
    razao_social: e.razao_social,
    nome: e.nome_fantasia ?? e.razao_social,
    cnpj: e.cnpj,
    ativo: e.ativo,
  }));

  return (
    <div className="space-y-6">
      <div>
        <BotaoVoltar reserva="/financeiro/cadastros" className="mb-3" />
        <PageHeader
          eyebrow="FINANCEIRO"
          title="Impostos"
          description="Os CNPJs que emitem nota, os CNAEs e as alíquotas de cada um, os vencimentos e os feriados. É a planilha de impostos dentro do sistema: o Faturar e a Apuração leem daqui."
          icon={Scale}
        />
      </div>

      <CadastroImpostos cadastro={cadastro} empresas={empresas} hoje={hojeEmSaoPauloIso()} />
    </div>
  );
}
