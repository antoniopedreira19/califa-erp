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

/**
 * Chips contextuais: ligados 1:1 com os cards do Dashboard. Clicar num
 * card do /rh/ferias?tab=dashboard → vai pra ?tab=colaboradores&filtro=X
 * e o chip X fica ativo já de cara. Mesma contagem pros dois lados.
 */
type FiltroKey =
  | ""
  | "em_ferias_hoje"
  | "saindo_7d"
  | "voltando_7d"
  | "vencida_recente"
  | "vencendo_30d"
  | "pendente_aprovacao"
  | "aguardando_financeiro";

const FILTROS: Array<{
  key: FiltroKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  cor: string;
  corAtivo: string;
}> = [
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
  {
    key: "vencendo_30d",
    label: "Vencendo em 30d",
    icon: AlertTriangle,
    cor: "bg-amber-100 text-amber-900",
    corAtivo: "bg-amber-600 text-white",
  },
  {
    key: "vencida_recente",
    label: "Vencidas",
    icon: AlertOctagon,
    cor: "bg-red-100 text-red-800",
    corAtivo: "bg-red-600 text-white",
  },
  {
    key: "pendente_aprovacao",
    label: "Pendentes aprovação",
    icon: Hourglass,
    cor: "bg-amber-100 text-amber-900",
    corAtivo: "bg-amber-600 text-white",
  },
  {
    key: "aguardando_financeiro",
    label: "Aguardando envio",
    icon: Send,
    cor: "bg-purple-100 text-purple-800",
    corAtivo: "bg-purple-600 text-white",
  },
];

function parseFiltro(v: string | undefined): FiltroKey {
  const vals: FiltroKey[] = FILTROS.map((f) => f.key);
  return (vals as string[]).includes(v ?? "") ? (v as FiltroKey) : "";
}

export function QuadroListaCliente({ rows, filtroInicial }: Props) {
  const [busca, setBusca] = React.useState("");
  const [tipoContratacao, setTipoContratacao] = React.useState("");
  const [filtro, setFiltro] = React.useState<FiltroKey>(
    parseFiltro(filtroInicial),
  );

  // Contagens de cada chip (sempre sobre o universo total, não o filtrado)
  const contagens = React.useMemo(() => {
    const m: Record<FiltroKey, number> = {
      "": rows.length,
      em_ferias_hoje: 0,
      saindo_7d: 0,
      voltando_7d: 0,
      vencendo_30d: 0,
      vencida_recente: 0,
      pendente_aprovacao: 0,
      aguardando_financeiro: 0,
    };
    for (const r of rows) {
      if (r.flags.em_ferias_hoje) m.em_ferias_hoje += 1;
      if (r.flags.saindo_7d) m.saindo_7d += 1;
      if (r.flags.voltando_7d) m.voltando_7d += 1;
      if (r.flags.vencendo_30d) m.vencendo_30d += 1;
      if (r.flags.vencida_recente) m.vencida_recente += 1;
      if (r.flags.pendente_aprovacao) m.pendente_aprovacao += 1;
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

  return (
    <>
      {/* Filtros */}
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
          {FILTROS.map((f) => {
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
          <div className="hidden md:grid grid-cols-[2fr_0.9fr_0.9fr_1fr_1fr_1fr_0.3fr] gap-4 bg-muted/40 px-5 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <span>Colaborador</span>
            <span>Admissão</span>
            <span>Aquisitivo</span>
            <span>Dias pend.</span>
            <span>Situação</span>
            <span>Data limite</span>
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
