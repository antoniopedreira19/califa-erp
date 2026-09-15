"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import type { RateioLinhaInput } from "@/lib/types";

interface RegionalOption {
  id: string;
  nome: string;
  ativo: boolean;
}

// onChange deve ser estável — passe um setter do useState ou um useCallback no caller.
interface Props {
  linhas: RateioLinhaInput[];
  onChange: (linhas: RateioLinhaInput[]) => void;
  regionais: RegionalOption[];
  disabled?: boolean;
}

const TOLERANCIA = 0.01;

function somaPercentual(linhas: RateioLinhaInput[]): number {
  return linhas.reduce((s, l) => s + l.percentual, 0);
}

function formatPct(n: number): string {
  return n.toFixed(2);
}

export function RateioRegionalEditor({
  linhas,
  onChange,
  regionais,
  disabled = false,
}: Props) {
  const regionaisAtivas = regionais.filter((r) => r.ativo);
  const regionalPorId = new Map(regionais.map((r) => [r.id, r]));

  const usadas = new Set(linhas.map((l) => l.regional_id));
  const soma = somaPercentual(linhas);
  const somaOk = Math.abs(soma - 100) < TOLERANCIA;

  function handleRegionalChange(idx: number, regional_id: string | null) {
    if (!regional_id) return;
    const novas = [...linhas];
    novas[idx] = { ...novas[idx], regional_id };
    onChange(novas);
  }

  function handlePercentualChange(idx: number, valor: string) {
    const num = Number(valor);
    if (Number.isNaN(num)) return;
    const novas = [...linhas];
    novas[idx] = { ...novas[idx], percentual: num };
    onChange(novas);
  }

  function handleRemove(idx: number) {
    const novas = linhas.filter((_, i) => i !== idx);
    onChange(novas);
  }

  function handleAdicionar() {
    const restante = Math.max(0, 100 - soma);
    onChange([
      ...linhas,
      { regional_id: "", percentual: Number(restante.toFixed(2)) },
    ]);
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-semibold text-foreground">
        Rateio de regional *
      </label>

      <div className="space-y-2">
        {linhas.map((linha, idx) => {
          const outrasUsadas = new Set(
            linhas.filter((_, i) => i !== idx).map((l) => l.regional_id),
          );
          const itensCombobox = regionaisAtivas
            .filter((r) => !outrasUsadas.has(r.id) || r.id === linha.regional_id)
            .map((r) => ({ value: r.id, label: r.nome }));

          // Se a regional atual é inativa, inclui na lista rotulada.
          const regAtual = regionalPorId.get(linha.regional_id);
          if (regAtual && !regAtual.ativo) {
            itensCombobox.push({
              value: regAtual.id,
              label: `${regAtual.nome} (inativa)`,
            });
          }

          return (
            <div
              key={idx}
              className="flex items-center gap-2 rounded-lg border border-border bg-white p-2"
            >
              <div className="flex-1">
                <Combobox
                  items={itensCombobox}
                  value={linha.regional_id || null}
                  onChange={(v) => handleRegionalChange(idx, v)}
                  placeholder="Selecione a regional"
                  disabled={disabled}
                />
              </div>
              <div className="w-24">
                <input
                  type="number"
                  min={0.01}
                  max={100}
                  step={0.01}
                  value={linha.percentual}
                  onChange={(e) => handlePercentualChange(idx, e.target.value)}
                  disabled={disabled}
                  className="no-spinner w-full rounded-md border border-border bg-white px-2 py-1.5 text-right text-sm"
                />
              </div>
              <span className="text-xs text-muted-foreground">%</span>
              <button
                type="button"
                onClick={() => handleRemove(idx)}
                disabled={disabled || linhas.length <= 1}
                className="rounded p-1 text-muted-foreground hover:bg-california-red/10 hover:text-california-red disabled:opacity-30"
                aria-label="Remover linha"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={handleAdicionar}
          disabled={disabled || usadas.size >= regionaisAtivas.length}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-white px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-california-red hover:text-california-red disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar regional
        </button>
        <div
          className={`text-sm font-semibold ${
            somaOk ? "text-emerald-700" : "text-california-red"
          }`}
        >
          Total: {formatPct(soma)}% {somaOk ? "✓" : ""}
        </div>
      </div>
    </div>
  );
}
