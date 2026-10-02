import { redirect } from "next/navigation";
import { Scale } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AbasFiscal, type AbaFiscal } from "./abas-fiscal";
import { carregarApuracao, contarGuiasAAprovar } from "./apuracao/dados";
import { AbaApuracao } from "./apuracao/aba-apuracao";
import { carregarImpostos, contarImpostosAPagar } from "./impostos/dados";
import { AbaImpostos } from "./impostos/aba-impostos";

export const dynamic = "force-dynamic";

/**
 * A seção Fiscal da Central Financeira (módulo fiscal, entrega 2 —
 * desenho aprovado pelo Tiago no protótipo de 30/09 a 02/10/2026): a
 * **Apuração** (as guias de cada mês e trimestre, calculadas das notas, dos
 * custos e das retenções, aprovadas com o valor da guia da contabilidade) e
 * os **Impostos a Pagar** (os títulos que a aprovação cria, com a baixa que
 * vai para a conciliação).
 *
 * Cada aba lê só o que é dela (`?aba=impostos`; a Apuração é a URL sem
 * `aba`). O número da aba Impostos a Pagar sai de uma contagem; o da
 * Apuração exige o cálculo inteiro, então só aparece com ela aberta.
 */
export default async function FiscalPage({
  searchParams,
}: {
  searchParams?: { aba?: string };
}) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const aba: AbaFiscal = searchParams?.aba === "impostos" ? "impostos" : "apuracao";

  const [apuracao, impostos, totalAPagar] = await Promise.all([
    aba === "apuracao" ? carregarApuracao(supabase, tenantId) : Promise.resolve(null),
    aba === "impostos" ? carregarImpostos(supabase, tenantId) : Promise.resolve(null),
    contarImpostosAPagar(supabase, tenantId),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <BotaoVoltar reserva="/financeiro" />
      </div>
      <PageHeader
        eyebrow="FINANCEIRO"
        title="Fiscal"
        description="Os impostos de cada mês e trimestre, calculados a partir das notas emitidas, dos custos dos jobs e das retenções. A guia aprovada vira imposto a pagar; a baixa vai para a conciliação."
        icon={Scale}
      />
      <AbasFiscal
        aba={aba}
        totalAAprovar={apuracao ? contarGuiasAAprovar(apuracao) : null}
        totalAPagar={totalAPagar}
      >
        {apuracao && <AbaApuracao dados={apuracao} />}
        {impostos && <AbaImpostos dados={impostos} />}
      </AbasFiscal>
    </div>
  );
}
