"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { ContaBancaria } from "@/lib/types";

export function FiltrosConta({
  contas,
  contaAtual,
  dataDe,
  dataAte,
}: {
  contas: ContaBancaria[];
  contaAtual?: string;
  dataDe: string;
  dataAte: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `useTransition` mantém a UI interativa enquanto o Server Component
  // re-renderiza. `isPending` ativa o dimming da section pra sinalizar
  // que algo está em curso — mesmo padrão do relatório de rentabilidade.
  const [isPending, startTransition] = React.useTransition();

  function update(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(patch).forEach(([k, v]) => {
      if (v === null) params.delete(k);
      else params.set(k, v);
    });
    startTransition(() => {
      router.push(`/financeiro/conciliacao?${params.toString()}`);
    });
  }

  return (
    <div
      data-pending={isPending || undefined}
      className={cn(
        "flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 transition-opacity",
        isPending && "opacity-60",
      )}
    >
      <div className="min-w-[280px] flex-1 space-y-1">
        <label className="text-[11px] uppercase text-muted-foreground">
          Conta bancária
        </label>
        <Select
          value={contaAtual ?? ""}
          onValueChange={(v) => update({ conta: v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione a conta..." />
          </SelectTrigger>
          <SelectContent>
            {contas.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nome} · {c.banco}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <label className="text-[11px] uppercase text-muted-foreground">
          De
        </label>
        <DatePicker
          name="de"
          defaultValue={dataDe}
          onDateChange={(d) =>
            update({ de: d ? format(d, "yyyy-MM-dd") : null })
          }
        />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] uppercase text-muted-foreground">
          Até
        </label>
        <DatePicker
          name="ate"
          defaultValue={dataAte}
          onDateChange={(d) =>
            update({ ate: d ? format(d, "yyyy-MM-dd") : null })
          }
        />
      </div>
    </div>
  );
}
