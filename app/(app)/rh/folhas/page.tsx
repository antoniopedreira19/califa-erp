import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt, Info } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/empty-state";
import { pode } from "@/lib/permissoes";
import type { FolhaLinhaStatus } from "@/lib/types";
import { FolhasList, type CompetenciaResumo } from "./folhas-list";

export const dynamic = "force-dynamic";

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export default async function FolhasPage() {
  const session = await requireSession();
  if (!pode(session.activeRole, "rh.folhas.ver")) {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("folhas_pagamento")
    .select("competencia_ano, competencia_mes, status")
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[rh.folhas.page]", error.message);
  }

  // Agrega linhas em competências.
  const mapa = new Map<string, CompetenciaResumo>();
  for (const l of (data ?? []) as {
    competencia_ano: number;
    competencia_mes: number;
    status: FolhaLinhaStatus;
  }[]) {
    const chave = `${l.competencia_ano}-${String(l.competencia_mes).padStart(2, "0")}`;
    const atual = mapa.get(chave) ?? {
      chave,
      ano: l.competencia_ano,
      mes: l.competencia_mes,
      nome: `${NOMES_MES[l.competencia_mes - 1]}/${l.competencia_ano}`,
      total: 0,
      rascunho: 0,
      enviada: 0,
      aprovada: 0,
      pendente_correcao: 0,
      paga: 0,
    };
    atual.total += 1;
    atual[l.status] += 1;
    mapa.set(chave, atual);
  }
  const competencias = Array.from(mapa.values()).sort((a, b) =>
    b.chave.localeCompare(a.chave),
  );

  const podeGerar = pode(session.activeRole, "rh.folhas.editar_rh");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="RH"
        title="Folhas de pagamento"
        description="Uma folha por competência. Cada linha é um colaborador; carrega salário base e rateio de alocação. RH gera, financeiro aprova."
        icon={Receipt}
      />

      {/* Aviso de rodada 1 — geração real chega na Rodada 2 */}
      {podeGerar && (
        <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Geração da folha entra em breve. Estrutura de banco e listagem
            estão prontas — próxima entrega libera o botão &ldquo;Nova
            folha&rdquo; e a revisão pelo RH.
          </span>
        </div>
      )}

      {competencias.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nenhuma folha registrada ainda"
          description="Assim que a geração for liberada, a folha do mês atual aparece aqui como rascunho pronto para revisão."
        />
      ) : (
        <FolhasList competencias={competencias} />
      )}
    </div>
  );
}
