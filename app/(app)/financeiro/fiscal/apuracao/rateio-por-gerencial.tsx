"use client";

/**
 * O rateio da guia por empresa gerencial, no painel da aprovação (decisão
 * 277). O valor de cada gerencial é o da contabilidade; abaixo dela, as
 * regionais pela regra (`lib/fiscal/rateio-gerencial`): a receita da
 * competência, a regional do CNPJ (GoCrazy → SS), a única regional da
 * empresa (Hitlab) ou, sem receita no período, a regional escolhida.
 */
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/ui/money-input";
import { cn } from "@/lib/utils";
import type { RateioDaGuia } from "@/lib/fiscal/apuracao";
import { r2 } from "@/lib/fiscal/datas";
import { dividirGerencial, textoDaDivisao, type ParteDaGerencial, type RegrasDoRateio } from "@/lib/fiscal/rateio-gerencial";
import { moeda, pct } from "./ui";

const CAMPO = "h-9 w-full min-w-0 rounded-md border border-input bg-white px-2.5 text-sm";

export function RateioPorGerencial({
  total,
  base,
  regras,
  partes,
  onChange,
}: {
  total: number;
  /** O rateio do sistema (pela receita da competência). */
  base: RateioDaGuia[];
  regras: RegrasDoRateio;
  partes: ParteDaGerencial[];
  onChange: (p: ParteDaGerencial[]) => void;
}) {
  // Com uma gerencial só, ela acompanha o valor da guia.
  React.useEffect(() => {
    if (partes.length === 1 && Math.abs(partes[0].valor - total) >= 0.01) onChange([{ ...partes[0], valor: r2(total) }]);
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

  const soma = r2(partes.reduce((s, p) => s + p.valor, 0));
  const falta = r2(total - soma);
  const trocar = (i: number, p: Partial<ParteDaGerencial>) => onChange(partes.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const livres = regras.empresas.filter((e) => !partes.some((p) => p.empresa_id === e.id));

  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">Rateio · por empresa gerencial</span>
        <span className={cn("text-[11.5px] font-semibold", Math.abs(falta) >= 0.01 ? "text-amber-700" : "text-emerald-700")}>
          {Math.abs(falta) >= 0.01 ? `Falta ${moeda(falta)}` : "Fecha com a guia"}
        </span>
      </div>
      {partes.map((p, i) => {
        const d = dividirGerencial(p, base, regras);
        const empresa = regras.empresas.find((e) => e.id === p.empresa_id);
        return (
          <div key={i} className="space-y-1">
            <div className="grid grid-cols-[1fr_140px_28px] items-center gap-2">
              <select
                className={CAMPO}
                value={p.empresa_id}
                onChange={(ev) => trocar(i, { empresa_id: ev.target.value, regional_id: null })}
                aria-label="Empresa gerencial"
              >
                {regras.empresas
                  .filter((e) => e.id === p.empresa_id || !partes.some((x) => x.empresa_id === e.id))
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
              </select>
              <MoneyInput value={p.valor} onValueChange={(v) => trocar(i, { valor: v })} />
              {partes.length > 1 ? (
                <button
                  type="button"
                  aria-label="Tirar esta empresa do rateio"
                  onClick={() => onChange(partes.filter((_, j) => j !== i))}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-california-red"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : (
                <span />
              )}
            </div>
            {(d.como === "sem_regional" || d.como === "escolhida") && empresa ? (
              <div className="flex items-center gap-2 pl-1 text-[11px] text-amber-800">
                <span className="shrink-0">Sem receita no período: regional</span>
                <select
                  className="h-7 rounded-md border border-input bg-white px-2 text-[12px]"
                  value={p.regional_id ?? ""}
                  onChange={(ev) => trocar(i, { regional_id: ev.target.value || null })}
                  aria-label="Regional"
                >
                  <option value="">Escolha</option>
                  {empresa.regionais.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nome}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="pl-1 text-[11px] text-muted-foreground">
                → {d.partes.map((x) => `${x.regional_nome ?? "—"}${d.partes.length > 1 ? ` ${pct(x.pct)}` : ""} ${moeda(x.valor)}`).join(" · ")}{" "}
                <span className="text-muted-foreground/70">({textoDaDivisao(d.como)})</span>
              </p>
            )}
          </div>
        );
      })}
      {livres.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([...partes, { empresa_id: livres[0].id, valor: Math.max(0, falta), regional_id: null }])}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-california-red hover:underline"
        >
          <Plus className="h-3.5 w-3.5" />
          {partes.length === 0 ? "Escolher a empresa gerencial" : "Outra empresa gerencial"}
        </button>
      )}
    </div>
  );
}
