import { redirect } from "next/navigation";
import { Car } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { DESGASTE_POR_KM_PADRAO } from "@/lib/calculos/reembolso";
import { formatDataHoraListaBr } from "@/lib/formatar-data-hora";
import { DesgasteForm } from "./desgaste-form";

export const dynamic = "force-dynamic";

/** O desgaste do veículo por km do reembolso de veículo próprio (decisão 187). */
export default async function ReembolsoVeiculoProprioPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/cadastros?reason=sem_permissao");
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("financeiro_parametros")
    .select("valor, atualizado_em, autor:profiles!atualizado_por(nome)")
    .eq("tenant_id", session.activeTenant.id)
    .eq("chave", "reembolso_desgaste_por_km")
    .maybeSingle<{ valor: number | string; atualizado_em: string; autor: { nome: string } | null }>();
  if (error) console.error("[cadastros.reembolso]", error.message);

  const valor = data ? Number(data.valor) : DESGASTE_POR_KM_PADRAO;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <BotaoVoltar reserva="/financeiro/cadastros" className="mb-3" />
        <PageHeader
          eyebrow="FINANCEIRO"
          title="Reembolso de veículo próprio"
          description="A PP de reembolso de veículo próprio paga o combustível e o desgaste do veículo de cada km rodado. O consumo e o preço do litro vêm em cada PP; o desgaste por km é este."
          icon={Car}
        />
      </div>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Desgaste do veículo por km</h2>
          <p className="text-sm text-muted-foreground">
            Valor = km ÷ consumo × preço do litro + km × desgaste por km. Mudar aqui vale para as PPs geradas
            daqui em diante.
          </p>
        </div>
        <DesgasteForm valorAtual={valor} podeEditar />
        <p className="text-xs text-muted-foreground">
          {data?.autor?.nome
            ? `Alterado por ${data.autor.nome} em ${formatDataHoraListaBr(data.atualizado_em)}.`
            : "Valor inicial da planilha de reembolso de gasolina."}
        </p>
      </section>
    </div>
  );
}
