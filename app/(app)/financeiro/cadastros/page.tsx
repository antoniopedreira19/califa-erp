import Link from "next/link";
import { ArrowRight, Wallet, ListTree, CreditCard, FolderKanban, Scale, Car, type LucideIcon } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { formatCurrency } from "@/lib/utils";
import { DESGASTE_POR_KM_PADRAO } from "@/lib/calculos/reembolso";

export const dynamic = "force-dynamic";

export default async function CadastrosFinanceiroPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [contasBancariasRes, tiposPlanoRes, cartoesCreditoRes, cnpjsEmissoresRes, desgasteRes] = await Promise.all([
    supabase
      .from("contas_bancarias")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    supabase
      .from("plano_contas_tipos")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    supabase
      .from("cartoes_credito")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    // Cadastro de impostos (módulo fiscal, 02/10/2026): conta os CNPJs
    // emissores ativos.
    supabase
      .from("fiscal_estabelecimentos")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    // O desgaste por km do reembolso de veículo próprio (decisão 187).
    supabase
      .from("financeiro_parametros")
      .select("valor")
      .eq("tenant_id", session.activeTenant.id)
      .eq("chave", "reembolso_desgaste_por_km")
      .maybeSingle<{ valor: number | string }>(),
  ]);

  if (contasBancariasRes.error) console.error("[fin-cadastros.contas_bancarias]", contasBancariasRes.error.message);
  if (tiposPlanoRes.error) console.error("[fin-cadastros.plano_contas_tipos]", tiposPlanoRes.error.message);
  if (cartoesCreditoRes.error) console.error("[fin-cadastros.cartoes_credito]", cartoesCreditoRes.error.message);
  if (cnpjsEmissoresRes.error) console.error("[fin-cadastros.fiscal_estabelecimentos]", cnpjsEmissoresRes.error.message);
  if (desgasteRes.error) console.error("[fin-cadastros.financeiro_parametros]", desgasteRes.error.message);
  const desgastePorKm = desgasteRes.data ? Number(desgasteRes.data.valor) : DESGASTE_POR_KM_PADRAO;

  return (
    <div className="space-y-6">
      <div>
        <BotaoVoltar reserva="/financeiro" className="mb-3" />
        <PageHeader
          eyebrow="FINANCEIRO"
          title="Cadastros do Financeiro"
          description="Estruturas de base pra operar o financeiro: onde o dinheiro entra e sai, como classificar cada lançamento e que cartões existem."
          icon={FolderKanban}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <CadastroCard
          href="/financeiro/cadastros/contas-bancarias"
          icon={Wallet}
          title="Contas bancárias"
          description="Contas onde os pagamentos entram e saem, com saldo inicial. Cada conta serve a qualquer empresa."
          count={contasBancariasRes.count ?? 0}
        />
        <CadastroCard
          href="/financeiro/cadastros/plano-de-contas"
          icon={ListTree}
          title="Plano de contas"
          description="Tipos e subtipos usados para classificar cada lançamento financeiro. Base do DRE."
          count={tiposPlanoRes.count ?? 0}
        />
        <CadastroCard
          href="/financeiro/cadastros/cartoes-credito"
          icon={CreditCard}
          title="Cartões de crédito"
          description="Cartões usados como forma de pagamento. O dia da fatura preenche a data de pagamento dos títulos automaticamente."
          count={cartoesCreditoRes.count ?? 0}
        />
        <CadastroCard
          href="/financeiro/cadastros/impostos"
          icon={Scale}
          title="Impostos"
          description="Os CNPJs que emitem nota, os CNAEs e as alíquotas de cada um, os vencimentos e os feriados. O Faturar e a Apuração leem daqui."
          count={cnpjsEmissoresRes.count ?? 0}
        />
        <CadastroCard
          href="/financeiro/cadastros/reembolso"
          icon={Car}
          title="Reembolso de veículo próprio"
          description="O desgaste do veículo por km que a PP de reembolso de veículo próprio soma ao combustível."
          resumo={`${formatCurrency(desgastePorKm, "BRL")} por km`}
        />
      </div>
    </div>
  );
}

function CadastroCard({
  href,
  icon: Icon,
  title,
  description,
  count,
  resumo,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  count?: number;
  /** No lugar da contagem, quando o cadastro é um valor só. */
  resumo?: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col rounded-2xl border border-border bg-card p-6 shadow-soft transition-all hover:border-california-red/30 hover:shadow-elevated"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
        <Icon className="h-5 w-5" />
      </div>

      <h3 className="mt-4 text-lg font-semibold text-foreground group-hover:text-california-red transition-colors">
        {title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        {resumo !== undefined ? (
          <p className="text-xs font-semibold text-foreground">{resumo}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{count ?? 0}</span>{" "}
            {count === 1 ? "ativo" : "ativos"}
          </p>
        )}
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
          Abrir
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
