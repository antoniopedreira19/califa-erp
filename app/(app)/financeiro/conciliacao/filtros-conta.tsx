"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
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
  // As datas seguem a URL (decisão 211, A3): o período que veio do servidor,
  // ou a escolha que ainda está navegando. Um link ou o voltar do navegador
  // trocam as props, e os campos acompanham.
  const [periodo, setPeriodo] = React.useState({ de: dataDe, ate: dataAte });
  React.useEffect(() => setPeriodo({ de: dataDe, ate: dataAte }), [dataDe, dataAte]);

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

  function mudarData(campo: "de" | "ate", d: Date | null) {
    const iso = d ? format(d, "yyyy-MM-dd") : "";
    setPeriodo((p) => ({ ...p, [campo]: iso }));
    update({ [campo]: iso || null });
  }

  // As setas andam um mês inteiro a partir do mês do "De" (o histórico da
  // planilha se navega mês a mês, decisão 211).
  const base = periodo.de || dataDe;
  const anterior = mesAoLado(base, -1);
  const seguinte = mesAoLado(base, 1);
  const irPara = (mes: { de: string; ate: string }) => {
    setPeriodo({ de: mes.de, ate: mes.ate });
    update({ de: mes.de, ate: mes.ate });
  };

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
        <DatePicker name="de" value={periodo.de} onDateChange={(d) => mudarData("de", d)} />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] uppercase text-muted-foreground">
          Até
        </label>
        <DatePicker name="ate" value={periodo.ate} onDateChange={(d) => mudarData("ate", d)} />
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11"
          aria-label={`Mês anterior: ${anterior.rotulo}`}
          title={`Mês anterior: ${anterior.rotulo}`}
          onClick={() => irPara(anterior)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11"
          aria-label={`Mês seguinte: ${seguinte.rotulo}`}
          title={`Mês seguinte: ${seguinte.rotulo}`}
          onClick={() => irPara(seguinte)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        {/* Sem `de` nem `ate` na URL, o período já é o mês atual. */}
        {(searchParams.has("de") || searchParams.has("ate")) && (
          <Button type="button" variant="ghost" size="sm" className="h-11" onClick={() => update({ de: null, ate: null })}>
            Mês atual
          </Button>
        )}
      </div>
    </div>
  );
}

/** O mês antes ou depois do mês de `iso`, do primeiro ao último dia, e o nome dele ("maio de 2026"). */
function mesAoLado(iso: string, passo: -1 | 1): { de: string; ate: string; rotulo: string } {
  const [ano, mes] = iso.split("-").map(Number);
  const inicio = new Date(Date.UTC(ano, mes - 1 + passo, 1));
  const a = inicio.getUTCFullYear();
  const m = inicio.getUTCMonth() + 1;
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return {
    de: `${a}-${mm}-01`,
    ate: `${a}-${mm}-${String(ultimo).padStart(2, "0")}`,
    rotulo: inicio.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}
