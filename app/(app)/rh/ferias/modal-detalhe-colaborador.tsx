"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
    data_admissao: string;
  };
  periodos: ColaboradorFeriasPeriodo[];
  lancamentos: ColaboradorFeriasLancamento[];
  /** Callback de fechar — passado pelo ModalDetalheWrapper. Fecha o modal
   *  via state local em vez de router.push, evitando round-trip RSC. */
  onFechar: () => void;
};

/**
 * Modal centralizado grande com visão operacional do colaborador.
 *
 * Layout:
 *   - Header: nome, função, tipo, admissão.
 *   - Ações rápidas: lançar direto, calcular rescisão.
 *   - Timeline HORIZONTAL dos períodos aquisitivos (scroll lateral se >5).
 *     Cada card compacto mostra: aquisitivo, status, usados/direito, limite.
 *   - Histórico cronológico de lançamentos.
 *
 * Substitui o drawer lateral apertado que estourava vertical.
 */
export function ModalDetalheColaborador({
  colaborador,
  periodos,
  lancamentos,
  onFechar,
}: Props) {
  const router = useRouter();
  const [formAberto, setFormAberto] = React.useState(false);

  const fechar = onFechar;

  // Dias usados (aprovado + concluído) por período — pra barra visual
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

  // Saldo total disponível (pra hero)
  const saldoTotal = periodos
    .filter((p) => p.status === "apto" || p.status === "em_alerta")
    .reduce((acc, p) => {
      const ocupados = diasOcupadosPorPeriodo.get(p.id) ?? 0;
      return acc + Math.max(p.dias_direito - ocupados, 0);
    }, 0);

  const admissaoFmt = colaborador.data_admissao
    ? new Date(colaborador.data_admissao + "T00:00:00").toLocaleDateString(
        "pt-BR",
      )
    : "—";

  return (
    <Dialog open onOpenChange={(o) => !o && fechar()}>
      <DialogContent
        className="max-w-5xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col"
      >
        {/* Header fixo */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="text-xl truncate">
                {colaborador.nome}
              </DialogTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {colaborador.funcao} ·{" "}
                {tipoContratacaoLabel(colaborador.tipo_contratacao)} · Admissão{" "}
                {admissaoFmt}
              </p>
            </div>
            <div className="flex items-center gap-6 shrink-0">
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Saldo disponível
                </p>
                <p className="text-2xl font-bold tracking-tight">
                  {saldoTotal}
                  <span className="text-sm font-medium text-muted-foreground ml-1">
                    dias
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={fechar}
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted transition-colors"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </DialogHeader>

        {/* Corpo rolável */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
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

          {/* Timeline HORIZONTAL dos períodos */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Períodos aquisitivos ({periodos.length})
            </h3>
            {periodos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum período gerado.
              </p>
            ) : (
              <div className="overflow-x-auto -mx-6 px-6 pb-2">
                <div className="flex gap-3 min-w-min">
                  {periodos.map((p) => {
                    const usados = diasUsadosPorPeriodo.get(p.id) ?? 0;
                    const pct = Math.min(
                      (usados / p.dias_direito) * 100,
                      100,
                    );
                    return (
                      <CardPeriodo
                        key={p.id}
                        periodo={p}
                        usados={usados}
                        pct={pct}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Histórico de lançamentos */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Lançamentos ({lancamentos.length})
            </h3>
            {lancamentos.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
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
      </DialogContent>
    </Dialog>
  );
}

function CardPeriodo({
  periodo: p,
  usados,
  pct,
}: {
  periodo: ColaboradorFeriasPeriodo;
  usados: number;
  pct: number;
}) {
  const pendentes = Math.max(p.dias_direito - usados, 0);
  const limiteFmt = new Date(
    p.data_limite_gozo + "T00:00:00",
  ).toLocaleDateString("pt-BR");
  const aquisitivoRotulo = `${p.aquisitivo_inicio.slice(0, 4)}/${p.aquisitivo_fim.slice(0, 4)}`;

  return (
    <div className="w-[180px] shrink-0 rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">#{p.numero}</p>
        <BadgePeriodo status={p.status} />
      </div>
      <p className="mt-1 text-sm font-semibold">{aquisitivoRotulo}</p>
      <div className="mt-3">
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-california-red"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs">
          <span className="font-semibold">{usados}</span>
          <span className="text-muted-foreground">/{p.dias_direito} usados</span>
        </p>
        <p className="text-xs">
          <span className="font-medium text-foreground">{pendentes}</span>
          <span className="text-muted-foreground"> pendentes</span>
        </p>
      </div>
      <div className="mt-2 pt-2 border-t border-border">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Limite p/ gozo
        </p>
        <p className="text-xs font-medium">{limiteFmt}</p>
      </div>
    </div>
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
      label: "N/habilitado",
      cls: "bg-muted text-muted-foreground",
    },
    pago_rescisao: {
      label: "Pago rescis.",
      cls: "bg-slate-200 text-slate-700",
    },
  };
  const info = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${info.cls}`}
    >
      {info.label}
    </span>
  );
}

function BadgeLancamento({ status }: { status: FeriasLancamentoStatus }) {
  const map: Record<FeriasLancamentoStatus, { label: string; cls: string }> = {
    pendente_aprovacao: {
      label: "Pendente",
      cls: "bg-amber-100 text-amber-900",
    },
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
