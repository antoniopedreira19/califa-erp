"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

type Props = {
  busca: string;
  tipoContratacao: string;
  statusPeriodo: string;
  totalColaboradores: number;
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
  {
    valor: "em_alerta",
    label: "Em alerta",
    cls: "bg-amber-100 text-amber-900",
  },
  { valor: "apto", label: "Aptos", cls: "bg-emerald-100 text-emerald-800" },
  {
    valor: "incompleto",
    label: "Em curso",
    cls: "bg-muted text-muted-foreground",
  },
];

export function QuadroFiltros({
  busca,
  tipoContratacao,
  statusPeriodo,
  totalColaboradores,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [buscaInput, setBuscaInput] = React.useState(busca);

  // Debounce da busca
  React.useEffect(() => {
    const t = setTimeout(() => {
      const atual = searchParams.get("busca") ?? "";
      if (buscaInput !== atual) {
        atualizarParam("busca", buscaInput || null);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaInput]);

  function atualizarParam(key: string, valor: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (valor === null || valor === "") {
      params.delete(key);
    } else {
      params.set(key, valor);
    }
    // Modal agora é state local (Onda 3), não via URL — nada a limpar aqui.
    router.push(`/rh/ferias?${params.toString()}`);
  }

  const temFiltroAtivo =
    buscaInput !== "" || tipoContratacao !== "" || statusPeriodo !== "";

  function limparFiltros() {
    setBuscaInput("");
    const params = new URLSearchParams();
    params.set("tab", "quadro");
    router.push(`/rh/ferias?${params.toString()}`);
  }

  return (
    <div className="space-y-3 mb-5">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Busca */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={buscaInput}
            onChange={(e) => setBuscaInput(e.target.value)}
            placeholder="Buscar por nome..."
            className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-2 text-sm transition-colors focus:border-california-red focus:outline-none focus:ring-2 focus:ring-california-red/15"
          />
        </div>

        {/* Tipo de contratação */}
        <select
          value={tipoContratacao}
          onChange={(e) => atualizarParam("tipo_contr", e.target.value || null)}
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
          {totalColaboradores}{" "}
          {totalColaboradores === 1 ? "colaborador" : "colaboradores"}
        </span>
      </div>

      {/* Chips de status do período */}
      <div className="flex flex-wrap gap-2">
        {STATUS_PERIODO.map((s) => {
          const ativo = s.valor === statusPeriodo;
          return (
            <button
              key={s.valor}
              type="button"
              onClick={() => atualizarParam("status_periodo", s.valor || null)}
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
  );
}
