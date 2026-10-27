import { History } from "lucide-react";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import type { HistoricoCarga } from "@/lib/types";
import { CargasDoHistorico, type CargaNaLista } from "./cargas-do-historico";

export const dynamic = "force-dynamic";

/**
 * As cargas do histórico da planilha financeira (decisão 211, A1): a lista e
 * o envio de um pacote novo. O histórico vai até 30/09/2026; a partir de
 * 01/10/2026 vale o sistema, menos a cauda: os movimentos e as notas dos
 * jobs até o 3T que não existem no sistema (A6).
 */
export default async function HistoricoDaPlanilhaPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("historico_cargas")
    .select(
      "id, nome, tipo, periodo_de, periodo_ate, planilha_versao, pacote_arquivo, esperado, gravado, situacao, created_at, concluida_em, encerrada_em, criada:profiles!criada_por(nome)",
    )
    .eq("tenant_id", session.activeTenant.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) console.error("[historico.page]", error.message);

  type Linha = Pick<
    HistoricoCarga,
    | "id"
    | "nome"
    | "tipo"
    | "periodo_de"
    | "periodo_ate"
    | "planilha_versao"
    | "pacote_arquivo"
    | "esperado"
    | "gravado"
    | "situacao"
    | "created_at"
    | "concluida_em"
    | "encerrada_em"
  > & { criada: { nome: string | null } | null };
  const cargas: CargaNaLista[] = ((data ?? []) as unknown as Linha[]).map(({ criada, ...c }) => ({
    ...c,
    criada_por_nome: criada?.nome ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <BotaoVoltar reserva="/financeiro/cadastros" className="mb-3" />
        <PageHeader
          eyebrow="FINANCEIRO"
          title="Histórico da planilha"
          description="As cargas do histórico da planilha financeira: até 30/09/2026, e depois disso só os jobs até o 3T que não existem no sistema. Carregar de novo o mesmo período troca a carga dele."
          icon={History}
        />
      </div>

      <CargasDoHistorico cargas={cargas} />
    </div>
  );
}
