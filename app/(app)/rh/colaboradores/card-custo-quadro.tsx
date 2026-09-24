"use client";

import * as React from "react";
import { Wallet, Eye, EyeOff } from "lucide-react";

/**
 * Card "Custo do quadro atual" com toggle de olho pra esconder o valor.
 * Vive no client pra segurar o estado local. O olho da lista de
 * colaboradores tem estado independente — cada área controla o seu.
 */
export function CardCustoQuadro({
  valor,
  colaboradoresComSalario,
  colaboradoresSemSalario,
}: {
  valor: number;
  colaboradoresComSalario: number;
  colaboradoresSemSalario: number;
}) {
  const [oculto, setOculto] = React.useState(false);

  const brl = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft flex flex-col justify-between min-h-[128px]">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-california-red/10 text-california-red">
          <Wallet className="h-4 w-4" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide">
          Custo do quadro atual
        </span>
        <button
          type="button"
          onClick={() => setOculto((v) => !v)}
          className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label={oculto ? "Mostrar valor" : "Esconder valor"}
          title={oculto ? "Mostrar valor" : "Esconder valor"}
        >
          {oculto ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>
      <div className="mt-3">
        <p className="font-bold tabular-nums leading-none text-3xl text-foreground">
          {oculto ? "R$ ●●●●●●" : brl.format(valor)}
        </p>
        <div className="mt-2">
          {colaboradoresSemSalario > 0 ? (
            <span className="text-xs text-california-red">
              {colaboradoresSemSalario}{" "}
              {colaboradoresSemSalario === 1
                ? "colaborador sem salário vigente"
                : "colaboradores sem salário vigente"}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Soma dos {colaboradoresComSalario} salários vigentes
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
