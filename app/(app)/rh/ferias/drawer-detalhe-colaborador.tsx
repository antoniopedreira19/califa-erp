"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Palmtree } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import type {
  ColaboradorFeriasPeriodo,
  ColaboradorFeriasLancamento,
  FeriasPeriodoStatus,
  FeriasLancamentoStatus,
  FeriasLancamentoTipo,
  TipoContratacao,
} from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import { LancarDiretoForm } from "./lancar-direto-form";
import { BotaoRecibo } from "./botao-recibo";

type Props = {
  colaborador: {
    id: string;
    nome: string;
    tipo_contratacao: TipoContratacao;
    funcao: string;
  };
  periodos: ColaboradorFeriasPeriodo[];
  lancamentos: ColaboradorFeriasLancamento[];
};

export function DrawerDetalheColaborador({
  colaborador,
  periodos,
  lancamentos,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formAberto, setFormAberto] = React.useState(false);

  function fechar() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("colab");
    router.push(`/rh/ferias?${params.toString()}`);
  }

  // Dias usados (aprovado + concluído) por período
  const diasUsadosPorPeriodo = new Map<string, number>();
  for (const l of lancamentos) {
    if (!l.periodo_id) continue;
    if (l.status !== "aprovado" && l.status !== "concluido") continue;
    diasUsadosPorPeriodo.set(
      l.periodo_id,
      (diasUsadosPorPeriodo.get(l.periodo_id) ?? 0) + l.dias,
    );
  }

  // Dias ocupados (inclui pendentes) por período — pra form de lançar direto
  const diasOcupadosPorPeriodo = new Map<string, number>();
  for (const l of lancamentos) {
    if (!l.periodo_id) continue;
    if (
      l.status !== "aprovado" &&
      l.status !== "concluido" &&
      l.status !== "pendente_aprovacao" &&
      l.status !== "em_analise"
    )
      continue;
    diasOcupadosPorPeriodo.set(
      l.periodo_id,
      (diasOcupadosPorPeriodo.get(l.periodo_id) ?? 0) + l.dias,
    );
  }

  const periodosComSaldo = periodos.map((p) => ({
    ...p,
    saldo: Math.max(
      p.dias_direito - (diasOcupadosPorPeriodo.get(p.id) ?? 0),
      0,
    ),
  }));

  return (
    <Dialog open onOpenChange={(o) => !o && fechar()}>
      <DrawerContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{colaborador.nome}</DialogTitle>
          <DialogDescription>
            {colaborador.funcao} · {tipoContratacaoLabel(colaborador.tipo_contratacao)}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-6 overflow-y-auto pb-4">
          {/* Ações do RH */}
          {!formAberto && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setFormAberto(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-california-red px-3 py-1.5 text-sm font-medium text-white hover:bg-california-red/90 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Lançar férias direto
              </button>
            </div>
          )}

          {formAberto && (
            <LancarDiretoForm
              colaboradorId={colaborador.id}
              tipoContratacao={colaborador.tipo_contratacao}
              periodosComSaldo={periodosComSaldo}
              onFechar={() => setFormAberto(false)}
              onSucesso={() => {
                setFormAberto(false);
                router.refresh();
              }}
            />
          )}

          {/* Timeline de períodos */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Períodos aquisitivos
            </h3>
            <ul className="space-y-2">
              {periodos.length === 0 && (
                <li className="text-sm text-muted-foreground">
                  Nenhum período gerado.
                </li>
              )}
              {periodos.map((p) => {
                const usados = diasUsadosPorPeriodo.get(p.id) ?? 0;
                const pct = Math.min((usados / p.dias_direito) * 100, 100);
                return (
                  <li
                    key={p.id}
                    className="rounded-lg border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-medium">
                          #{p.numero} · {p.aquisitivo_inicio.slice(0, 4)}/
                          {p.aquisitivo_fim.slice(0, 4)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Limite:{" "}
                          {new Date(
                            p.concessivo_fim + "T00:00:00",
                          ).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <BadgePeriodo status={p.status} />
                    </div>
                    <div className="mt-2.5">
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-california-red"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {usados}/{p.dias_direito} usufruídos ·{" "}
                        <span className="font-medium text-foreground">
                          {Math.max(p.dias_direito - usados, 0)} pendentes
                        </span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Histórico de lançamentos */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Lançamentos ({lancamentos.length})
            </h3>
            {lancamentos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum lançamento ainda.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {lancamentos.map((l) => {
                  const temValor =
                    l.valor_total !== null && Number(l.valor_total) > 0;
                  const podeMostrarRecibo =
                    (l.status === "aprovado" || l.status === "concluido") &&
                    colaborador.tipo_contratacao !== "clt" &&
                    temValor;
                  return (
                    <li
                      key={l.id}
                      className="flex items-center justify-between gap-3 p-3 flex-wrap"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {new Date(
                            l.data_inicio + "T00:00:00",
                          ).toLocaleDateString("pt-BR")}{" "}
                          a{" "}
                          {new Date(
                            l.data_fim + "T00:00:00",
                          ).toLocaleDateString("pt-BR")}{" "}
                          · {l.dias} {l.dias === 1 ? "dia" : "dias"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {tipoLabel(l.tipo)}
                          {l.lancado_direto_por_rh && " · lançado pelo RH"}
                        </p>
                        {temValor && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Total: R${" "}
                            {Number(l.valor_total).toLocaleString("pt-BR", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </p>
                        )}
                        {l.motivo_reprovacao && (
                          <p className="mt-0.5 text-xs text-red-700">
                            Motivo: {l.motivo_reprovacao}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <BadgeLancamento status={l.status} />
                        {podeMostrarRecibo && (
                          <BotaoRecibo
                            lancamentoId={l.id}
                            temRecibo={!!l.recibo_url}
                            tipoLancamento={l.tipo}
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </DrawerContent>
    </Dialog>
  );
}

function tipoLabel(t: FeriasLancamentoTipo): string {
  switch (t) {
    case "usufruto":
      return "Férias (dias de folga)";
    case "abono_combinado":
      return "Abono combinado";
    case "abono_avulso":
      return "Abono avulso";
    case "abono_excepcional":
      return "Abono excepcional";
  }
}

function BadgePeriodo({ status }: { status: FeriasPeriodoStatus }) {
  const map: Record<FeriasPeriodoStatus, { label: string; cls: string }> = {
    incompleto: { label: "Em curso", cls: "bg-muted text-muted-foreground" },
    apto: { label: "Apto", cls: "bg-emerald-100 text-emerald-800" },
    em_alerta: { label: "Em alerta", cls: "bg-amber-100 text-amber-900" },
    vencido: { label: "Vencido", cls: "bg-red-100 text-red-800" },
    regularizado: { label: "Regularizado", cls: "bg-sky-100 text-sky-800" },
    nao_habilitado: {
      label: "Não habilitado",
      cls: "bg-muted text-muted-foreground",
    },
    pago_rescisao: {
      label: "Pago rescisão",
      cls: "bg-slate-200 text-slate-700",
    },
  };
  const info = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${info.cls}`}
    >
      {info.label}
    </span>
  );
}

function BadgeLancamento({ status }: { status: FeriasLancamentoStatus }) {
  const map: Record<FeriasLancamentoStatus, { label: string; cls: string }> = {
    pendente_aprovacao: { label: "Pendente", cls: "bg-amber-100 text-amber-900" },
    em_analise: { label: "Em análise", cls: "bg-sky-100 text-sky-800" },
    aprovado: { label: "Aprovado", cls: "bg-emerald-100 text-emerald-800" },
    reprovado: { label: "Reprovado", cls: "bg-red-100 text-red-800" },
    cancelado: { label: "Cancelado", cls: "bg-muted text-muted-foreground" },
    concluido: { label: "Concluído", cls: "bg-slate-200 text-slate-700" },
  };
  const info = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${info.cls}`}
    >
      {info.label}
    </span>
  );
}
