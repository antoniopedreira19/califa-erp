"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/ui/money-input";
import { formatCurrency } from "@/lib/utils";
import { salvarDesgastePorKm } from "./actions";

export function DesgasteForm({ valorAtual, podeEditar }: { valorAtual: number; podeEditar: boolean }) {
  const router = useRouter();
  const [valor, setValor] = React.useState(valorAtual);
  const [erro, setErro] = React.useState<string | null>(null);
  const [salvo, setSalvo] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const mudou = Math.abs(valor - valorAtual) >= 0.005;

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvo(false);
    startTransition(async () => {
      const res = await salvarDesgastePorKm({ valor });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setSalvo(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={salvar} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-[180px]">
          <label htmlFor="desgaste-por-km" className="text-xs font-medium">
            Desgaste por km
          </label>
          <MoneyInput
            id="desgaste-por-km"
            value={valor}
            onValueChange={(v) => {
              setValor(v);
              setSalvo(false);
            }}
            aria-label="Desgaste do veículo por km"
            disabled={!podeEditar || pending}
            className="text-right font-mono font-semibold"
          />
        </div>
        {podeEditar && (
          <Button type="submit" disabled={pending || !mudou}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        )}
        {salvo && !mudou && (
          <span className="inline-flex items-center gap-1.5 pb-3 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Salvo — vale para as próximas PPs.
          </span>
        )}
      </div>
      {mudou && (
        <p className="text-xs text-muted-foreground">
          De {formatCurrency(valorAtual, "BRL")} para {formatCurrency(valor, "BRL")} por km. As PPs já geradas
          mantêm o valor com que nasceram.
        </p>
      )}
      {erro && <p className="text-xs font-semibold text-california-red">{erro}</p>}
    </form>
  );
}
