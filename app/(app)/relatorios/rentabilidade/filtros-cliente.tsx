"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { MultiSelect } from "@/components/ui/multi-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  type FiltrosRentabilidade,
  filtrosParaQueryString,
  type Trimestre,
} from "./parse-filtros";
import { useModo } from "./modo-provider";

const TRIMESTRES: readonly { value: Trimestre; label: string }[] = [
  { value: "Q1", label: "Q1" },
  { value: "Q2", label: "Q2" },
  { value: "Q3", label: "Q3" },
  { value: "Q4", label: "Q4" },
];

interface Props {
  filtros: FiltrosRentabilidade;
  clientes: { id: string; nome: string }[];
  marcas: { id: string; nome: string; clienteId: string }[];
  empresas: { id: string; nome: string }[];
  regionais: { id: string; nome: string }[];
}

export function FiltrosCliente({
  filtros,
  clientes,
  marcas,
  empresas,
  regionais,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  // `useTransition` mantém a UI interativa enquanto o Server Component
  // re-renderiza. `isPending` ativa o dimming da section pra sinalizar
  // que algo está em curso (P1 do diagnóstico de perf).
  const [isPending, startTransition] = React.useTransition();
  const { modo, setModo } = useModo();

  const aplicar = (mudanca: Partial<FiltrosRentabilidade>) => {
    // `modo` vem do provider (client state), não do prop `filtros` — senão
    // trocar modo client-side seria revertido no próximo router.push.
    const novo = { ...filtros, modo, ...mudanca };
    // Regra 3.7: se cliente saiu, remover marcas orfas.
    if (mudanca.clientesIds !== undefined) {
      const clientesValidos = new Set(mudanca.clientesIds);
      if (clientesValidos.size > 0) {
        novo.marcasIds = novo.marcasIds.filter((mid) => {
          const marca = marcas.find((m) => m.id === mid);
          return marca && clientesValidos.has(marca.clienteId);
        });
      }
    }
    const qs = filtrosParaQueryString(novo);
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  // Marcas oferecidas ao usuario: filtradas pelos clientes selecionados (spec §3.7).
  const marcasDisponiveis =
    filtros.clientesIds.length > 0
      ? marcas.filter((m) => filtros.clientesIds.includes(m.clienteId))
      : marcas;

  const anos = anosDisponiveis();

  return (
    <section
      data-pending={isPending || undefined}
      className={cn(
        "rounded-2xl border border-border bg-card p-5 shadow-soft space-y-4 transition-opacity",
        isPending && "opacity-60",
      )}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo label="Ano">
          <select
            value={filtros.ano}
            onChange={(e) => aplicar({ ano: Number(e.target.value) })}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            {anos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Campo>

        <Campo label="Trimestres">
          <div className="flex gap-2">
            {TRIMESTRES.map((t) => {
              const marcado = filtros.trimestres.includes(t.value);
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() =>
                    aplicar({
                      trimestres: marcado
                        ? filtros.trimestres.filter((q) => q !== t.value)
                        : ([...filtros.trimestres, t.value].sort() as Trimestre[]),
                    })
                  }
                  className={cn(
                    "flex-1 h-9 rounded-md border text-xs font-semibold transition-colors",
                    marcado
                      ? "border-california-red bg-california-red text-white"
                      : "border-border bg-background text-foreground hover:border-california-red/40",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </Campo>

        <Campo label="Empresas">
          <MultiSelect
            items={empresas.map((e) => ({ value: e.id, label: e.nome }))}
            value={filtros.empresasIds}
            onChange={(v) => aplicar({ empresasIds: v })}
            placeholder="Todas"
          />
        </Campo>

        <Campo label="Regionais">
          <MultiSelect
            items={regionais.map((r) => ({ value: r.id, label: r.nome }))}
            value={filtros.regionaisIds}
            onChange={(v) => aplicar({ regionaisIds: v })}
            placeholder="Todas"
          />
        </Campo>

        <Campo label="Clientes">
          <MultiSelect
            items={clientes.map((c) => ({ value: c.id, label: c.nome }))}
            value={filtros.clientesIds}
            onChange={(v) => aplicar({ clientesIds: v })}
            placeholder="Todos"
          />
        </Campo>

        <Campo label="Marcas">
          <MultiSelect
            items={marcasDisponiveis.map((m) => ({ value: m.id, label: m.nome }))}
            value={filtros.marcasIds}
            onChange={(v) => aplicar({ marcasIds: v })}
            placeholder={
              filtros.clientesIds.length > 0 ? "Todas do cliente" : "Todas"
            }
          />
        </Campo>

        <Campo label="Faturamento acima de">
          <Input
            type="number"
            inputMode="decimal"
            step="1000"
            placeholder="Ex.: 1.000.000"
            value={filtros.faturamentoMinimo ?? ""}
            onChange={(e) => {
              const n = Number(e.target.value);
              aplicar({
                faturamentoMinimo: Number.isFinite(n) && n > 0 ? n : null,
              });
            }}
          />
        </Campo>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
        {/* Modo NÃO usa `aplicar` — vive no ModoProvider e troca sem re-render
            do server (P7). A URL é sincronizada via history.replaceState. */}
        <TogglePill
          label="Modo"
          opcoes={[
            { valor: "previsto", rotulo: "Previsto" },
            { valor: "realizado", rotulo: "Realizado" },
          ]}
          valor={modo}
          onChange={setModo}
        />

        <TogglePill
          label="Visualizar por"
          opcoes={[
            { valor: "cliente", rotulo: "Cliente" },
            { valor: "marca", rotulo: "Marca" },
            { valor: "job", rotulo: "Job" },
          ]}
          valor={filtros.visao}
          onChange={(v) => aplicar({ visao: v as FiltrosRentabilidade["visao"] })}
        />

        <div className="flex items-center gap-2">
          <input
            id="comparar"
            type="checkbox"
            checked={filtros.compararAno !== null}
            onChange={(e) =>
              aplicar({ compararAno: e.target.checked ? filtros.ano - 1 : null })
            }
            className="h-4 w-4 rounded border-border text-california-red focus:ring-california-red/40"
          />
          <Label htmlFor="comparar" className="text-sm">
            Comparar 2 períodos
          </Label>
          {filtros.compararAno !== null && (
            <select
              value={filtros.compararAno}
              onChange={(e) => aplicar({ compararAno: Number(e.target.value) })}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            >
              {anos
                .filter((a) => a !== filtros.ano)
                .map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
            </select>
          )}
        </div>
      </div>
    </section>
  );
}

function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function TogglePill<T extends string>({
  label,
  opcoes,
  valor,
  onChange,
}: {
  label: string;
  opcoes: { valor: T; rotulo: string }[];
  valor: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
        {opcoes.map((o) => (
          <button
            key={o.valor}
            type="button"
            onClick={() => onChange(o.valor)}
            className={cn(
              "px-3 py-1 text-xs font-semibold rounded-md transition-colors",
              valor === o.valor
                ? "bg-california-red text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}

function anosDisponiveis(): number[] {
  const atual = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, i) => atual - i);
}
