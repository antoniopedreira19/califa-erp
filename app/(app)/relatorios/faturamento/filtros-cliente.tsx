"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { MultiSelect } from "@/components/ui/multi-select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  type FiltrosFaturamento,
  filtrosParaQueryString,
  type Trimestre,
} from "./parse-filtros";
import {
  LABELS_STATUS_FATURAMENTO,
  STATUS_FATURAMENTO,
  type StatusFaturamento,
} from "@/lib/relatorios/faturamento-status";

const TRIMESTRES: readonly { value: Trimestre; label: string }[] = [
  { value: "Q1", label: "T1" },
  { value: "Q2", label: "T2" },
  { value: "Q3", label: "T3" },
  { value: "Q4", label: "T4" },
];

interface Props {
  filtros: FiltrosFaturamento;
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
  const [isPending, startTransition] = React.useTransition();

  const aplicar = (mudanca: Partial<FiltrosFaturamento>) => {
    const novo = { ...filtros, ...mudanca };
    // Regra 3.7 do relatório de rentabilidade: se cliente saiu, remover
    // marcas órfãs. Mesma lógica aqui — marca é FK indireta via cliente.
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

        <Campo label="Status">
          <MultiSelect
            items={STATUS_FATURAMENTO.map((s) => ({
              value: s,
              label: LABELS_STATUS_FATURAMENTO[s],
            }))}
            value={filtros.statusList}
            onChange={(v) => aplicar({ statusList: v as StatusFaturamento[] })}
            placeholder="Todos"
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

function anosDisponiveis(): number[] {
  const atual = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, i) => atual - i);
}
