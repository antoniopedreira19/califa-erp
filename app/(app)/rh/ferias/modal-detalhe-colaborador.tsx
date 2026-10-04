"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CalendarClock,
} from "lucide-react";
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
  /** Fecha o modal via state local do wrapper (evita round-trip RSC). */
  onFechar: () => void;
};

type TabKey = "anteriores" | "futuros" | "historico";

/**
 * Modal de detalhe do colaborador — hero fixo + abas pra contexto.
 *
 * Hierarquia visual:
 *   1. Hero(s) do(s) período(s) acionável(is) — SEMPRE fixo no topo
 *      do corpo. Se tiver 2+ (regra dos avós), lista todos como heros.
 *   2. Abas abaixo (3): Anteriores · Futuros · Histórico. Cada aba tem
 *      badge com contagem. Default = aba com conteúdo (prioriza
 *      Histórico se tiver, senão Anteriores, senão Futuros).
 *
 * Substituiu os 3 colapsáveis (anteriores/futuros/histórico empilhados)
 * — ficava muita rolagem. Com abas o modal tem altura previsível.
 */
export function ModalDetalheColaborador({
  colaborador,
  periodos,
  lancamentos,
  onFechar,
}: Props) {
  const router = useRouter();
  const [formAberto, setFormAberto] = React.useState(false);

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

  // Dias ocupados (inclui pendentes) por período — pro form
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

  // Categoriza períodos pela ação possível HOJE
  const periodosAtivos = periodos.filter(
    (p) =>
      p.status === "apto" ||
      p.status === "em_alerta" ||
      p.status === "vencido",
  );
  const periodosPassados = periodos.filter(
    (p) => p.status === "regularizado" || p.status === "pago_rescisao",
  );
  const periodosFuturos = periodos.filter(
    (p) => p.status === "incompleto" || p.status === "nao_habilitado",
  );

  // Lançamentos — divididos entre acionáveis (agendados/pendentes/em curso)
  // e histórico (concluído, reprovado, cancelado).
  const hojeISO = new Date().toISOString().slice(0, 10);
  const lancamentosAgendados = lancamentos.filter(
    (l) =>
      l.status === "pendente_aprovacao" ||
      l.status === "em_analise" ||
      (l.status === "aprovado" && l.data_fim >= hojeISO),
  );
  const lancamentosHistorico = lancamentos.filter(
    (l) => !lancamentosAgendados.includes(l),
  );

  const saldoTotal = periodosAtivos.reduce((acc, p) => {
    const ocupados = diasOcupadosPorPeriodo.get(p.id) ?? 0;
    return acc + Math.max(p.dias_direito - ocupados, 0);
  }, 0);

  const admissaoFmt = colaborador.data_admissao
    ? new Date(colaborador.data_admissao + "T00:00:00").toLocaleDateString(
        "pt-BR",
      )
    : "—";

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-4 pr-8">
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
            <div className="text-right shrink-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Saldo disponível
              </p>
              <p className="text-2xl font-bold tracking-tight leading-none mt-1">
                {saldoTotal}
                <span className="text-sm font-medium text-muted-foreground ml-1">
                  dias
                </span>
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Corpo rolável */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Form de lançar direto (quando aberto) */}
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

          {!formAberto && (
            <ModalCorpoComTabs
              periodosAtivos={periodosAtivos}
              periodosPassados={periodosPassados}
              periodosFuturos={periodosFuturos}
              lancamentosAgendados={lancamentosAgendados}
              lancamentosHistorico={lancamentosHistorico}
              lancamentosTodos={lancamentos}
              diasUsadosPorPeriodo={diasUsadosPorPeriodo}
              diasOcupadosPorPeriodo={diasOcupadosPorPeriodo}
              tipoContratacao={colaborador.tipo_contratacao}
              onAbrirForm={() => setFormAberto(true)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------- Corpo do modal (hero fixo + tabs) ----------------- */

function ModalCorpoComTabs({
  periodosAtivos,
  periodosPassados,
  periodosFuturos,
  lancamentosAgendados,
  lancamentosHistorico,
  lancamentosTodos,
  diasUsadosPorPeriodo,
  diasOcupadosPorPeriodo,
  tipoContratacao,
  onAbrirForm,
}: {
  periodosAtivos: ColaboradorFeriasPeriodo[];
  periodosPassados: ColaboradorFeriasPeriodo[];
  periodosFuturos: ColaboradorFeriasPeriodo[];
  lancamentosAgendados: ColaboradorFeriasLancamento[];
  lancamentosHistorico: ColaboradorFeriasLancamento[];
  lancamentosTodos: ColaboradorFeriasLancamento[];
  diasUsadosPorPeriodo: Map<string, number>;
  diasOcupadosPorPeriodo: Map<string, number>;
  tipoContratacao: TipoContratacao;
  onAbrirForm: () => void;
}) {
  // Default da aba: prioriza o que o RH mais vai consultar. Histórico se
  // existir, senão Anteriores, senão Futuros. Se nenhum tem conteúdo, cai
  // em Anteriores (visualmente neutro).
  const tabInicial: TabKey =
    lancamentosAgendados.length + lancamentosHistorico.length > 0
      ? "historico"
      : periodosPassados.length > 0
        ? "anteriores"
        : "futuros";
  const [tab, setTab] = React.useState<TabKey>(tabInicial);

  const totalHistorico = lancamentosAgendados.length + lancamentosHistorico.length;

  return (
    <>
      {/* Hero fixo — período(s) atual(is) */}
      {periodosAtivos.length === 0 ? (
        <div className="rounded-xl border border-border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum período disponível pra lançar férias no momento.
          </p>
        </div>
      ) : (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {periodosAtivos.length === 1
                ? "Situação atual"
                : `Períodos pra tirar (${periodosAtivos.length})`}
            </h3>
            <button
              type="button"
              onClick={onAbrirForm}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-3 py-1.5 text-sm font-medium text-white hover:bg-california-red/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Lançar férias
            </button>
          </div>
          <div className="space-y-3">
            {periodosAtivos.map((p) => {
              const usados = diasUsadosPorPeriodo.get(p.id) ?? 0;
              const ocupados = diasOcupadosPorPeriodo.get(p.id) ?? 0;
              const lancsDoPeriodo = lancamentosTodos.filter(
                (l) => l.periodo_id === p.id,
              );
              return (
                <HeroPeriodo
                  key={p.id}
                  periodo={p}
                  usados={usados}
                  saldo={Math.max(p.dias_direito - ocupados, 0)}
                  lancamentos={lancsDoPeriodo}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Tabs: contexto adicional (anteriores · futuros · histórico) */}
      {(periodosPassados.length > 0 ||
        periodosFuturos.length > 0 ||
        totalHistorico > 0) && (
        <section className="pt-2">
          <div className="border-b border-border">
            <nav className="flex gap-4" role="tablist">
              <AbaBotao
                ativo={tab === "anteriores"}
                onClick={() => setTab("anteriores")}
                contagem={periodosPassados.length}
                label="Anteriores"
              />
              <AbaBotao
                ativo={tab === "futuros"}
                onClick={() => setTab("futuros")}
                contagem={periodosFuturos.length}
                label="Futuros"
              />
              <AbaBotao
                ativo={tab === "historico"}
                onClick={() => setTab("historico")}
                contagem={totalHistorico}
                label="Histórico"
              />
            </nav>
          </div>

          <div className="pt-4">
            {tab === "anteriores" && (
              <AbaConteudoPeriodos
                periodos={periodosPassados}
                diasUsadosPorPeriodo={diasUsadosPorPeriodo}
                vazio="Nenhum período anterior regularizado."
              />
            )}
            {tab === "futuros" && (
              <AbaConteudoPeriodos
                periodos={periodosFuturos}
                diasUsadosPorPeriodo={diasUsadosPorPeriodo}
                vazio="Nenhum período futuro em curso."
              />
            )}
            {tab === "historico" && (
              <AbaConteudoHistorico
                agendados={lancamentosAgendados}
                historico={lancamentosHistorico}
                tipoContratacao={tipoContratacao}
              />
            )}
          </div>
        </section>
      )}
    </>
  );
}

function AbaBotao({
  ativo,
  onClick,
  label,
  contagem,
}: {
  ativo: boolean;
  onClick: () => void;
  label: string;
  contagem: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativo}
      onClick={onClick}
      className={`px-1 pb-2.5 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
        ativo
          ? "border-california-red text-california-red"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      <span
        className={`inline-flex items-center justify-center min-w-[20px] rounded-full px-1.5 py-0 text-[10px] font-semibold ${
          ativo
            ? "bg-california-red/10 text-california-red"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {contagem}
      </span>
    </button>
  );
}

function AbaConteudoPeriodos({
  periodos,
  diasUsadosPorPeriodo,
  vazio,
}: {
  periodos: ColaboradorFeriasPeriodo[];
  diasUsadosPorPeriodo: Map<string, number>;
  vazio: string;
}) {
  if (periodos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">{vazio}</p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {periodos.map((p) => (
        <LinhaPeriodoCompacta
          key={p.id}
          periodo={p}
          usados={diasUsadosPorPeriodo.get(p.id) ?? 0}
        />
      ))}
    </ul>
  );
}

function AbaConteudoHistorico({
  agendados,
  historico,
  tipoContratacao,
}: {
  agendados: ColaboradorFeriasLancamento[];
  historico: ColaboradorFeriasLancamento[];
  tipoContratacao: TipoContratacao;
}) {
  if (agendados.length === 0 && historico.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        Nenhum lançamento registrado.
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {agendados.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Agendadas e pendentes ({agendados.length})
          </h4>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {agendados.map((l) => (
              <LinhaLancamento
                key={l.id}
                lancamento={l}
                tipoContratacao={tipoContratacao}
              />
            ))}
          </ul>
        </div>
      )}
      {historico.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Concluídas ({historico.length})
          </h4>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {historico.map((l) => (
              <LinhaLancamento
                key={l.id}
                lancamento={l}
                tipoContratacao={tipoContratacao}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ----------------------- Hero do período atual ----------------------- */

function HeroPeriodo({
  periodo: p,
  usados,
  saldo,
  lancamentos,
}: {
  periodo: ColaboradorFeriasPeriodo;
  usados: number;
  saldo: number;
  lancamentos: ColaboradorFeriasLancamento[];
}) {
  const pct = Math.min((usados / p.dias_direito) * 100, 100);
  const aquisitivoRotulo = `${p.aquisitivo_inicio.slice(0, 4)}/${p.aquisitivo_fim.slice(0, 4)}`;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const limite = new Date(p.data_limite_gozo + "T00:00:00");
  const diasAteLimite = Math.ceil(
    (limite.getTime() - hoje.getTime()) / 86_400_000,
  );
  const limiteFmt = limite.toLocaleDateString("pt-BR");

  // Tom visual por status
  const tom: Record<
    "vencido" | "em_alerta" | "apto",
    {
      borda: string;
      bg: string;
      icone: React.ReactNode;
      labelPrazo: string;
      textoPrazo: string;
    }
  > = {
    vencido: {
      borda: "border-red-300",
      bg: "bg-red-50/60",
      icone: <AlertOctagon className="h-5 w-5 text-red-700" />,
      labelPrazo: "Vencido",
      textoPrazo: `há ${-diasAteLimite} dias`,
    },
    em_alerta: {
      borda: "border-amber-300",
      bg: "bg-amber-50/60",
      icone: <AlertTriangle className="h-5 w-5 text-amber-700" />,
      labelPrazo: "Prazo final",
      textoPrazo: `em ${diasAteLimite} dias`,
    },
    apto: {
      borda: "border-emerald-300",
      bg: "bg-emerald-50/40",
      icone: <CheckCircle2 className="h-5 w-5 text-emerald-700" />,
      labelPrazo: "Prazo final",
      textoPrazo: `em ${diasAteLimite} dias`,
    },
  };
  const t = tom[p.status as "vencido" | "em_alerta" | "apto"] ?? tom.apto;

  const agendados = lancamentos.filter(
    (l) =>
      l.status === "aprovado" ||
      l.status === "pendente_aprovacao" ||
      l.status === "em_analise",
  );

  return (
    <div className={`rounded-xl border-2 ${t.borda} ${t.bg} p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {t.icone}
          <div>
            <p className="text-sm font-semibold">
              Período aquisitivo {aquisitivoRotulo}
            </p>
            <p className="text-xs text-muted-foreground">
              De{" "}
              {new Date(p.aquisitivo_inicio + "T00:00:00").toLocaleDateString(
                "pt-BR",
              )}{" "}
              a{" "}
              {new Date(p.aquisitivo_fim + "T00:00:00").toLocaleDateString(
                "pt-BR",
              )}
            </p>
          </div>
        </div>
        <BadgePeriodo status={p.status} />
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Saldo pra tirar
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight leading-none">
            {saldo}
            <span className="text-sm font-medium text-muted-foreground ml-1">
              dias
            </span>
          </p>
          <div className="mt-3 h-1.5 w-full rounded-full bg-white/80 overflow-hidden">
            <div
              className="h-full bg-california-red"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {usados}/{p.dias_direito} dias já gozados
          </p>
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t.labelPrazo}
          </p>
          <p className="mt-1 text-lg font-semibold">{limiteFmt}</p>
          <p className="text-xs text-muted-foreground">{t.textoPrazo}</p>
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Concessivo
          </p>
          <p className="mt-1 text-sm">
            até{" "}
            {new Date(p.concessivo_fim + "T00:00:00").toLocaleDateString(
              "pt-BR",
            )}
          </p>
        </div>
      </div>

      {agendados.length > 0 && (
        <div className="mt-5 pt-4 border-t border-black/5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Agendados nesse período
          </p>
          <ul className="space-y-1.5">
            {agendados.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">
                    {new Date(l.data_inicio + "T00:00:00").toLocaleDateString(
                      "pt-BR",
                    )}{" "}
                    a{" "}
                    {new Date(l.data_fim + "T00:00:00").toLocaleDateString(
                      "pt-BR",
                    )}{" "}
                    · {l.dias}d
                  </span>
                </div>
                <BadgeLancamento status={l.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ----------------------- Linha compacta de período ---------------------- */

function LinhaPeriodoCompacta({
  periodo: p,
  usados,
}: {
  periodo: ColaboradorFeriasPeriodo;
  usados: number;
}) {
  const aquisitivoRotulo = `${p.aquisitivo_inicio.slice(0, 4)}/${p.aquisitivo_fim.slice(0, 4)}`;
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <div className="flex items-center gap-3 min-w-0">
        <span className="font-medium">{aquisitivoRotulo}</span>
        <span className="text-xs text-muted-foreground">
          {usados}/{p.dias_direito} dias
        </span>
      </div>
      <BadgePeriodo status={p.status} />
    </li>
  );
}

/* ----------------------- Linha de lançamento ---------------------------- */

function LinhaLancamento({
  lancamento: l,
  tipoContratacao,
}: {
  lancamento: ColaboradorFeriasLancamento;
  tipoContratacao: TipoContratacao;
}) {
  const temValor = l.valor_total !== null && Number(l.valor_total) > 0;
  const podeMostrarRecibo =
    (l.status === "aprovado" || l.status === "concluido") &&
    tipoContratacao !== "clt" &&
    temValor;

  return (
    <li className="flex items-center justify-between gap-3 p-3 flex-wrap">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {new Date(l.data_inicio + "T00:00:00").toLocaleDateString("pt-BR")} a{" "}
          {new Date(l.data_fim + "T00:00:00").toLocaleDateString("pt-BR")} ·{" "}
          {l.dias} {l.dias === 1 ? "dia" : "dias"}
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
}

/* --------------------------- Badges ------------------------------------ */

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
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 ${info.cls}`}
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
