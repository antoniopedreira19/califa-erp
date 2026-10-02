"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { LinhaQuadro } from "./linha-quadro";
import { ModalDetalheWrapper } from "./modal-detalhe-wrapper";
import type { QuadroColaboradorRow } from "./aba-quadro";

type Props = {
  rows: QuadroColaboradorRow[];
};

const TIPOS_CONTRATACAO = [
  { valor: "", label: "Todos" },
  { valor: "clt", label: "CLT" },
  { valor: "pj", label: "PJ" },
  { valor: "estagio", label: "Estágio" },
  { valor: "art", label: "ART" },
  { valor: "socio", label: "Sócio" },
];

const STATUS_PERIODO = [
  { valor: "", label: "Todos", cls: "" },
  { valor: "vencido", label: "Vencidos", cls: "bg-red-100 text-red-800" },
  { valor: "em_alerta", label: "Em alerta", cls: "bg-amber-100 text-amber-900" },
  { valor: "apto", label: "Aptos", cls: "bg-emerald-100 text-emerald-800" },
  {
    valor: "incompleto",
    label: "Em curso",
    cls: "bg-muted text-muted-foreground",
  },
];

/**
 * Quadro + filtros 100% client-side (Onda 3.5).
 *
 * Antes: cada chip de filtro clicado disparava router.push → request RSC
 * completa com 3 queries + render. 1,5-6s por clique, sensação de travamento.
 * Agora: filtros vivem em state local, aplicados em memória sobre as rows
 * já carregadas. Instantâneo (<10ms).
 *
 * Modal continua client-side via state local (ModalDetalheWrapper).
 */
export function QuadroListaCliente({ rows }: Props) {
  const [busca, setBusca] = React.useState("");
  const [tipoContratacao, setTipoContratacao] = React.useState("");
  const [statusPeriodo, setStatusPeriodo] = React.useState("");
  const [colabSelecionadoId, setColabSelecionadoId] = React.useState<
    string | null
  >(null);

  const rowsFiltradas = React.useMemo(() => {
    let res = rows;

    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      res = res.filter((r) => r.nome.toLowerCase().includes(q));
    }

    if (tipoContratacao) {
      res = res.filter((r) => r.tipo_contratacao === tipoContratacao);
    }

    if (statusPeriodo) {
      res = res.filter((r) => r.periodoAtivo?.status === statusPeriodo);
    }

    return res;
  }, [rows, busca, tipoContratacao, statusPeriodo]);

  const temFiltroAtivo = Boolean(
    busca || tipoContratacao || statusPeriodo,
  );

  function limparFiltros() {
    setBusca("");
    setTipoContratacao("");
    setStatusPeriodo("");
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
          {STATUS_PERIODO.map((s) => {
            const ativo = s.valor === statusPeriodo;
            return (
              <button
                key={s.valor}
                type="button"
                onClick={() => setStatusPeriodo(s.valor)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  ativo
                    ? "bg-california-red text-white"
                    : s.cls || "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {s.label}
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
              <LinhaQuadro
                key={row.id}
                row={row}
                onAbrir={() => setColabSelecionadoId(row.id)}
              />
            ))}
          </ul>
        </div>
      )}

      {colabSelecionadoId && (
        <ModalDetalheWrapper
          colaboradorId={colabSelecionadoId}
          onFechar={() => setColabSelecionadoId(null)}
        />
      )}
    </>
  );
}
