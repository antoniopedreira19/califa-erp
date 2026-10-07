import { redirect } from "next/navigation";
import { Scale } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { carregarCadastroFiscal } from "@/lib/fiscal/cadastro";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import type { EmpresaContabil } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { CadastroImpostos, type EmpresaDoCadastro, type RegionalDaPP } from "./cadastro-impostos";

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
  const [cadastro, empresasRes, regionaisRes, cnpjDaRegionalRes] = await Promise.all([
    carregarCadastroFiscal(supabase, session.activeTenant.id),
    supabase
      .from("empresas_contabeis")
      .select("id, razao_social, nome_fantasia, cnpj, ativo")
      .eq("tenant_id", session.activeTenant.id)
      .returns<Pick<EmpresaContabil, "id" | "razao_social" | "nome_fantasia" | "cnpj" | "ativo">[]>(),
    // Decisão 156: as regionais de projeto e o CNPJ da PP de cada uma.
    supabase
      .from("regionais")
      .select("id, nome, empresa:empresas(nome_fantasia, razao_social, principal)")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .eq("disponivel_em_projetos", true)
      .order("nome"),
    supabase
      .from("fiscal_cnpj_da_pp_por_regional")
      .select("regional_id, estabelecimento_id")
      .eq("tenant_id", session.activeTenant.id),
  ]);
  if (regionaisRes.error) console.error("[fiscal.impostos.regionais]", regionaisRes.error.message);
  if (cnpjDaRegionalRes.error) console.error("[fiscal.impostos.cnpj_da_regional]", cnpjDaRegionalRes.error.message);
  const cnpjPorRegional = new Map(
    ((cnpjDaRegionalRes.data ?? []) as Array<{ regional_id: string; estabelecimento_id: string }>).map((m) => [
      m.regional_id,
      m.estabelecimento_id,
    ]),
  );
  type EmpresaDaRegional = { nome_fantasia: string | null; razao_social: string; principal: boolean | null };
  const regionaisDaPP: RegionalDaPP[] = ((regionaisRes.data ?? []) as unknown as Array<{
    id: string;
    nome: string;
    empresa: EmpresaDaRegional | EmpresaDaRegional[] | null;
  }>)
    .map((r) => {
      const e = Array.isArray(r.empresa) ? r.empresa[0] : r.empresa;
      return {
        id: r.id,
        nome: r.nome,
        empresa: e ? (e.nome_fantasia ?? e.razao_social) : "—",
        principal: e?.principal === true,
        estabelecimento_id: cnpjPorRegional.get(r.id) ?? null,
      };
    })
    .sort((a, b) => Number(b.principal) - Number(a.principal) || a.empresa.localeCompare(b.empresa, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));
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

      <CadastroImpostos cadastro={cadastro} empresas={empresas} regionaisDaPP={regionaisDaPP} hoje={hojeEmSaoPauloIso()} />
    </div>
  );
}
