"use client";

import * as React from "react";
import {
  Search,
  X,
  Palmtree,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  AlertOctagon,
  Hourglass,
  Send,
  FileClock,
  ChevronRight,
} from "lucide-react";
import { LinhaQuadro } from "./linha-quadro";
import type { QuadroColaboradorRow } from "./aba-quadro";

type Props = {
  rows: QuadroColaboradorRow[];
  filtroInicial?: string;
};

const TIPOS_CONTRATACAO = [
  { valor: "", label: "Todos" },
  { valor: "clt", label: "CLT" },
  { valor: "pj", label: "PJ" },
  { valor: "estagio", label: "Estágio" },
  { valor: "art", label: "ART" },
  { valor: "socio", label: "Sócio" },
];

type FiltroKey =
  | ""
  | "em_ferias_hoje"
  | "saindo_7d"
  | "voltando_7d"
  | "vencida_recente"
  | "vencendo_30d"
  | "pendente_aprovacao"
  | "aguardando_nf"
  | "aguardando_financeiro";

type CardAcaoConfig = {
  key: FiltroKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tom: "danger" | "warning" | "info" | "roxo";
};

// Cards no topo — ação urgente do RH
const CARDS_ACAO: CardAcaoConfig[] = [
  {
    key: "vencida_recente",
    label: "Férias vencidas",
    icon: AlertOctagon,
    tom: "danger",
  },
  {
    key: "pendente_aprovacao",
    label: "Pendentes aprovação",
    icon: Hourglass,
    tom: "warning",
  },
  {
    key: "aguardando_nf",
    label: "Aguardando NF",
    icon: FileClock,
    tom: "info",
  },
  {
    key: "aguardando_financeiro",
    label: "Aguardando envio",
    icon: Send,
    tom: "roxo",
  },
  {
    key: "vencendo_30d",
    label: "Vencendo em 30d",
    icon: AlertTriangle,
    tom: "warning",
  },
];

type ChipConfig = {
  key: FiltroKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  cor: string;
  corAtivo: string;
};

// Chips embaixo — visão contextual (quem está fora esta semana)
const CHIPS_SEMANA: ChipConfig[] = [
  {
    key: "",
    label: "Todos",
    icon: Search,
    cor: "bg-muted text-muted-foreground",
    corAtivo: "bg-foreground text-background",
  },
  {
    key: "em_ferias_hoje",
    label: "Em férias hoje",
    icon: Palmtree,
    cor: "bg-sky-100 text-sky-800",
    corAtivo: "bg-sky-600 text-white",
  },
  {
    key: "saindo_7d",
    label: "Saindo 7d",
    icon: ArrowRight,
    cor: "bg-amber-100 text-amber-900",
    corAtivo: "bg-amber-600 text-white",
  },
  {
    key: "voltando_7d",
    label: "Voltando 7d",
    icon: ArrowLeft,
    cor: "bg-emerald-100 text-emerald-800",
    corAtivo: "bg-emerald-600 text-white",
  },
];

const TOM_STYLES: Record<
  CardAcaoConfig["tom"],
  { bg: string; number: string; icone: string; border: string; borderAtivo: string }
> = {
  danger: {
    bg: "bg-california-red/5",
    number: "text-california-red",
    icone: "text-california-red",
    border: "border-california-red/20 hover:border-california-red/40",
    borderAtivo: "border-california-red ring-2 ring-california-red/20",
  },
  warning: {
    bg: "bg-amber-50/60",
    number: "text-amber-700",
    icone: "text-amber-600",
    border: "border-amber-300/40 hover:border-amber-500/60",
    borderAtivo: "border-amber-600 ring-2 ring-amber-500/20",
  },
  info: {
    bg: "bg-sky-50/50",
    number: "text-sky-700",
    icone: "text-sky-600",
    border: "border-sky-300/40 hover:border-sky-500/60",
    borderAtivo: "border-sky-600 ring-2 ring-sky-500/20",
  },
  roxo: {
    bg: "bg-purple-50/50",
    number: "text-purple-700",
    icone: "text-purple-600",
    border: "border-purple-300/40 hover:border-purple-500/60",
    borderAtivo: "border-purple-600 ring-2 ring-purple-500/20",
  },
};

const TODAS_FILTRO_KEYS: FiltroKey[] = [
  "",
  "em_ferias_hoje",
  "saindo_7d",
  "voltando_7d",
  "vencida_recente",
  "vencendo_30d",
  "pendente_aprovacao",
  "aguardando_nf",
  "aguardando_financeiro",
];

function parseFiltro(v: string | undefined): FiltroKey {
  return (TODAS_FILTRO_KEYS as string[]).includes(v ?? "")
    ? (v as FiltroKey)
    : "";
}

export function QuadroListaCliente({ rows, filtroInicial }: Props) {
  const [busca, setBusca] = React.useState("");
  const [tipoContratacao, setTipoContratacao] = React.useState("");
  const [filtro, setFiltro] = React.useState<FiltroKey>(
    parseFiltro(filtroInicial),
  );

  // Contagens de cada filtro (sempre sobre o universo total, não o filtrado)
  const contagens = React.useMemo(() => {
    const m: Record<FiltroKey, number> = {
      "": rows.length,
      em_ferias_hoje: 0,
      saindo_7d: 0,
      voltando_7d: 0,
      vencendo_30d: 0,
      vencida_recente: 0,
      pendente_aprovacao: 0,
      aguardando_nf: 0,
      aguardando_financeiro: 0,
    };
    for (const r of rows) {
      if (r.flags.em_ferias_hoje) m.em_ferias_hoje += 1;
      if (r.flags.saindo_7d) m.saindo_7d += 1;
      if (r.flags.voltando_7d) m.voltando_7d += 1;
      if (r.flags.vencendo_30d) m.vencendo_30d += 1;
      if (r.flags.vencida_recente) m.vencida_recente += 1;
      if (r.flags.pendente_aprovacao) m.pendente_aprovacao += 1;
      if (r.flags.aguardando_nf) m.aguardando_nf += 1;
      if (r.flags.aguardando_financeiro) m.aguardando_financeiro += 1;
    }
    return m;
  }, [rows]);

  const rowsFiltradas = React.useMemo(() => {
    let res = rows;

    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      res = res.filter((r) => r.nome.toLowerCase().includes(q));
    }

    if (tipoContratacao) {
      res = res.filter((r) => r.tipo_contratacao === tipoContratacao);
    }

    if (filtro) {
      res = res.filter((r) => r.flags[filtro]);
    }

    return res;
  }, [rows, busca, tipoContratacao, filtro]);

  const temFiltroAtivo = Boolean(busca || tipoContratacao || filtro);

  function limparFiltros() {
    setBusca("");
    setTipoContratacao("");
    setFiltro("");
  }

  function toggleFiltro(key: FiltroKey) {
    // Clicar no card/chip ativo → desseleciona (volta pra Todos)
    setFiltro((atual) => (atual === key ? "" : key));
  }

  return (
    <>
      {/* Cards de ação (cliques filtram a lista) */}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5 mb-4">
        {CARDS_ACAO.map((c) => {
          const s = TOM_STYLES[c.tom];
          const value = contagens[c.key];
          const ativo = filtro === c.key;
          const Icon = c.icon;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => toggleFiltro(c.key)}
              className={`block rounded-xl border p-4 transition-all text-left shadow-soft ${s.bg} ${
                ativo ? s.borderAtivo : s.border
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <Icon className={`h-5 w-5 ${s.icone}`} />
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className={`mt-3 text-3xl font-bold tracking-tight ${s.number}`}>
                {value}
              </p>
              <p className="mt-1 text-sm font-medium">{c.label}</p>
            </button>
          );
        })}
      </div>

      {/* Chips contextuais + busca */}
      <div className="space-y-3 mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome..."
              className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-2 text-sm transition-colors focus:border-california-red focus:outline-none focus:ring-2 focus:ring-california-red/15"
            />
          </div>

          <select
            value={tipoContratacao}
            onChange={(e) => setTipoContratacao(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm transition-colors focus:border-california-red focus:outline-none focus:ring-2 focus:ring-california-red/15"
          >
            {TIPOS_CONTRATACAO.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.label}
              </option>
            ))}
          </select>

          {temFiltroAtivo && (
            <button
              type="button"
              onClick={limparFiltros}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Limpar filtros
            </button>
          )}

          <span className="ml-auto text-xs text-muted-foreground">
            {rowsFiltradas.length}{" "}
            {rowsFiltradas.length === 1 ? "colaborador" : "colaboradores"}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {CHIPS_SEMANA.map((f) => {
            const ativo = f.key === filtro;
            const count = contagens[f.key];
            const Icon = f.icon;
            return (
              <button
                key={f.key || "todos"}
                type="button"
                onClick={() => setFiltro(f.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  ativo ? f.corAtivo : f.cor + " hover:brightness-95"
                }`}
              >
                <Icon className="h-3 w-3" />
                {f.label}
                {count > 0 && (
                  <span
                    className={`inline-flex items-center justify-center min-w-[18px] rounded-full px-1 text-[10px] font-semibold ${
                      ativo ? "bg-white/25" : "bg-white/60"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Lista */}
      {rowsFiltradas.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum colaborador com esses filtros.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
          <div className="hidden md:grid grid-cols-[2fr_0.9fr_0.9fr_1fr_1.4fr_0.3fr] gap-4 bg-muted/40 px-5 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <span>Colaborador</span>
            <span>Admissão</span>
            <span>Aquisitivo</span>
            <span>Dias pend.</span>
            <span>Prazo</span>
            <span className="sr-only">Ação</span>
          </div>
          <ul className="divide-y divide-border">
            {rowsFiltradas.map((row) => (
              <LinhaQuadro key={row.id} row={row} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
