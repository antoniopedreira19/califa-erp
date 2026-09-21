import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt, ArrowLeft, Wallet, AlertCircle, PlayCircle, CalendarClock } from "lucide-react";
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

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

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
    pendente_correcao: number;
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
      pendente_correcao: 0,
    };
    atual.colaboradores += 1;
    atual.totalValor += Number(l.salario_base);
    if (l.status === "rascunho") atual.rascunho += 1;
    if (l.status === "paga") atual.paga += 1;
    if (l.status === "pendente_correcao") atual.pendente_correcao += 1;
    mapa.set(chave, atual);
  }

  const listaAcc = Array.from(mapa.values()).sort((a, b) =>
    b.chave.localeCompare(a.chave),
  );

  const competencias: CompetenciaResumo[] = listaAcc.map((a) => {
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
  });

  // KPIs agregados
  const agora = new Date();
  const anoAtual = agora.getFullYear();
  const mesAtualCorrente = agora.getMonth() + 1;

  const chaveAtual = `${anoAtual}-${String(mesAtualCorrente).padStart(2, "0")}`;
  const folhaAtual = competencias.find((c) => c.chave === chaveAtual);

  const totalAnual = listaAcc
    .filter((a) => a.ano === anoAtual)
    .reduce((acc, a) => acc + a.totalValor, 0);

  const pendenciasTotais = listaAcc.reduce(
    (acc, a) => acc + a.pendente_correcao,
    0,
  );

  const emAndamento = competencias.filter(
    (c) => c.statusAgregado === "enviada",
  ).length;

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

      {competencias.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icone={<Wallet className="h-4 w-4" />}
            rotulo={`Folha de ${NOMES_MES[mesAtualCorrente - 1]}/${anoAtual}`}
            valorPrincipal={
              folhaAtual ? brl.format(folhaAtual.totalValor) : "—"
            }
            rodape={
              folhaAtual ? (
                <span className="text-xs text-muted-foreground">
                  {folhaAtual.colaboradores} colaboradores
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Não gerada ainda
                </span>
              )
            }
            destaque
          />
          <KpiCard
            icone={<CalendarClock className="h-4 w-4" />}
            rotulo={`Acumulado ${anoAtual}`}
            valorPrincipal={brl.format(totalAnual)}
            rodape={
              <span className="text-xs text-muted-foreground">
                {competencias.filter((c) => c.ano === anoAtual).length}{" "}
                competência(s)
              </span>
            }
          />
          <KpiCard
            icone={<PlayCircle className="h-4 w-4" />}
            rotulo="Em andamento"
            valorPrincipal={String(emAndamento)}
            rodape={
              <span className="text-xs text-muted-foreground">
                {emAndamento === 1 ? "folha" : "folhas"} no fluxo com o
                financeiro
              </span>
            }
          />
          <KpiCard
            icone={<AlertCircle className="h-4 w-4" />}
            rotulo="Pendências abertas"
            valorPrincipal={String(pendenciasTotais)}
            rodape={
              pendenciasTotais > 0 ? (
                <span className="text-xs font-medium text-california-red">
                  Corrigir e reenviar
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Nada pendente
                </span>
              )
            }
            tom={pendenciasTotais > 0 ? "vermelho" : undefined}
          />
        </div>
      )}

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

function KpiCard({
  icone,
  rotulo,
  valorPrincipal,
  rodape,
  destaque,
  tom,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valorPrincipal: string;
  rodape: React.ReactNode;
  destaque?: boolean;
  tom?: "vermelho";
}) {
  const corValor =
    tom === "vermelho" && valorPrincipal !== "0"
      ? "text-california-red"
      : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft flex flex-col justify-between min-h-[128px]">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-california-red/10 text-california-red">
          {icone}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide">
          {rotulo}
        </span>
      </div>
      <div className="mt-3">
        <p
          className={`font-bold tabular-nums leading-none ${
            destaque ? "text-3xl" : "text-2xl"
          } ${corValor}`}
        >
          {valorPrincipal}
        </p>
        <div className="mt-2">{rodape}</div>
      </div>
    </div>
  );
}
