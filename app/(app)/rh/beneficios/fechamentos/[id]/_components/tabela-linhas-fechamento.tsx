"use client";

import * as React from "react";
import type { BeneficioFechamentoLinha } from "@/lib/types";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const ROTULO_MODO: Record<string, string> = {
  rateado: "Rateado 60/40",
  integral_empresa: "100% empresa",
  integral_empresa_com_upgrade: "Upgrade (empresa + diferença)",
};

export function TabelaLinhasFechamento(props: {
  linhas: BeneficioFechamentoLinha[];
}) {
  const [busca, setBusca] = React.useState("");
  const [operadoraFiltro, setOperadoraFiltro] = React.useState<string>("");

  const operadoras = React.useMemo(() => {
    return Array.from(new Set(props.linhas.map((l) => l.beneficio_operadora)));
  }, [props.linhas]);

  const linhasFiltradas = React.useMemo(() => {
    const buscaNorm = busca.trim().toLowerCase();
    return props.linhas.filter((l) => {
      if (operadoraFiltro && l.beneficio_operadora !== operadoraFiltro) return false;
      if (buscaNorm) {
        // Como o snapshot não tem o nome do colaborador congelado, caímos pro id
        // (busca é pelos nomes de benefício/operadora/modo que estão em cada linha).
        const combo = `${l.beneficio_nome} ${l.beneficio_operadora} ${l.modo_custeio}`.toLowerCase();
        if (!combo.includes(buscaNorm)) return false;
      }
      return true;
    });
  }, [props.linhas, busca, operadoraFiltro]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Buscar benefício / operadora / modo..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="flex-1 min-w-[220px] rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
        <select
          value={operadoraFiltro}
          onChange={(e) => setOperadoraFiltro(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Todas operadoras</option>
          {operadoras.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {linhasFiltradas.length} de {props.linhas.length}
        </span>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Benefício</th>
                <th className="px-3 py-2 font-medium">Operadora</th>
                <th className="px-3 py-2 font-medium">Modo custeio</th>
                <th className="px-3 py-2 font-medium text-right">Titular</th>
                <th className="px-3 py-2 font-medium text-right">Deps</th>
                <th className="px-3 py-2 font-medium text-right">Integral</th>
                <th className="px-3 py-2 font-medium text-right">Empresa</th>
                <th className="px-3 py-2 font-medium text-right">Colab.</th>
                <th className="px-3 py-2 font-medium text-right">Qtd deps</th>
              </tr>
            </thead>
            <tbody>
              {linhasFiltradas.map((l) => (
                <tr key={l.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2">{l.beneficio_nome}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {l.beneficio_operadora}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {ROTULO_MODO[l.modo_custeio] ?? l.modo_custeio}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {brl.format(Number(l.valor_titular))}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {brl.format(Number(l.valor_dependentes_total))}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {brl.format(Number(l.valor_integral))}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {brl.format(Number(l.valor_empresa))}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {brl.format(Number(l.valor_colaborador))}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {l.qtd_dependentes_na_competencia}
                  </td>
                </tr>
              ))}
              {linhasFiltradas.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-6 text-center text-sm text-muted-foreground"
                  >
                    Nenhuma linha encontrada com esses filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
