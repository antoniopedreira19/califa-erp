import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt, ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/empty-state";
import { pode } from "@/lib/permissoes";
import type { FolhaLinhaStatus } from "@/lib/types";
import {
  FolhasList,
  type CompetenciaResumo,
  type StatusAgregado,
} from "./folhas-list";
import { NovaFolhaModal } from "./nova-folha-modal";

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
    .select("competencia_ano, competencia_mes, status, salario_base")
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[rh.folhas.page]", error.message);
  }

  // Agrega linhas por competência. Status agregado é derivado das linhas
  // (sem coluna no banco). Regra:
  //   concluida = todas as linhas em `paga`
  //   rascunho  = nenhuma linha enviada ainda (todas em `rascunho`)
  //   enviada   = qualquer outro estado (é o "em andamento")
  // Ver docs/modulos/rh/30-proximos-passos.md §D1.
  type Acc = {
    chave: string;
    ano: number;
    mes: number;
    nome: string;
    colaboradores: number;
    totalValor: number;
    rascunho: number;
    paga: number;
  };
  const mapa = new Map<string, Acc>();
  for (const l of (data ?? []) as {
    competencia_ano: number;
    competencia_mes: number;
    status: FolhaLinhaStatus;
    salario_base: string | number;
  }[]) {
    const chave = `${l.competencia_ano}-${String(l.competencia_mes).padStart(2, "0")}`;
    const atual = mapa.get(chave) ?? {
      chave,
      ano: l.competencia_ano,
      mes: l.competencia_mes,
      nome: `${NOMES_MES[l.competencia_mes - 1]}/${l.competencia_ano}`,
      colaboradores: 0,
      totalValor: 0,
      rascunho: 0,
      paga: 0,
    };
    atual.colaboradores += 1;
    atual.totalValor += Number(l.salario_base);
    if (l.status === "rascunho") atual.rascunho += 1;
    if (l.status === "paga") atual.paga += 1;
    mapa.set(chave, atual);
  }
  const competencias: CompetenciaResumo[] = Array.from(mapa.values())
    .map((a) => {
      let statusAgregado: StatusAgregado;
      if (a.colaboradores > 0 && a.paga === a.colaboradores) {
        statusAgregado = "concluida";
      } else if (a.rascunho === a.colaboradores) {
        statusAgregado = "rascunho";
      } else {
        statusAgregado = "enviada";
      }
      return {
        chave: a.chave,
        ano: a.ano,
        mes: a.mes,
        nome: a.nome,
        colaboradores: a.colaboradores,
        totalValor: a.totalValor,
        statusAgregado,
      };
    })
    .sort((a, b) => b.chave.localeCompare(a.chave));

  const podeGerar = pode(session.activeRole, "rh.folhas.editar_rh");

  return (
    <div className="space-y-6">
      <Link
        href="/rh"
        prefetch={false}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3 w-3" />
        Voltar para RH
      </Link>

      <PageHeader
        eyebrow="RH"
        title="Folhas de pagamento"
        description="Uma folha por competência. Cada linha é um colaborador; carrega salário base e rateio de alocação. RH gera, financeiro aprova."
        icon={Receipt}
        actions={podeGerar ? <NovaFolhaModal /> : undefined}
      />

      {competencias.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nenhuma folha registrada ainda"
          description={
            podeGerar
              ? "Clique em Nova folha para gerar a primeira competência."
              : "Aguarde o RH gerar a primeira folha."
          }
          action={podeGerar ? <NovaFolhaModal /> : undefined}
        />
      ) : (
        <FolhasList competencias={competencias} />
      )}
    </div>
  );
}
