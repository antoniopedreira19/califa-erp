"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { FilaAbertura, type FilaLinha } from "./fila-list";
import { JobsAbertosList } from "./jobs-abertos-list";
import type { JobAberto } from "./dados-abertos";

type Aba = "aguardando" | "abertos";

/**
 * As duas abas da Abertura de Job, como no design: a fila do que ainda
 * precisa ser aberto e a lista do que já foi.
 *
 * As duas listas descem prontas do server component e a aba é só estado
 * de tela — trocar de aba não refaz query. São dois SELECTs leves (a fila
 * costuma ter poucas linhas), carregados em paralelo, o que também mantém
 * as duas contagens do cabeçalho sempre verdadeiras.
 */
export function AberturaTabs({
  fila,
  abertos,
}: {
  fila: FilaLinha[];
  abertos: JobAberto[];
}) {
  const [aba, setAba] = React.useState<Aba>(
    // Fila vazia é o estado normal do dia a dia: abrir direto em "Jobs
    // abertos" poupa um clique e evita receber um empty state na cara.
    fila.length > 0 ? "aguardando" : "abertos",
  );

  const abas: { key: Aba; rotulo: string; contagem: number }[] = [
    { key: "aguardando", rotulo: "Jobs aguardando abertura", contagem: fila.length },
    { key: "abertos", rotulo: "Jobs abertos", contagem: abertos.length },
  ];

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Seções da abertura de job"
        className="flex items-center gap-1 border-b border-border"
      >
        {abas.map((a) => {
          const ativo = aba === a.key;
          return (
            <button
              key={a.key}
              type="button"
              role="tab"
              aria-selected={ativo}
              onClick={() => setAba(a.key)}
              className={cn(
                "mr-5 inline-flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-semibold transition-colors",
                ativo
                  ? "border-california-red text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {a.rotulo}
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold",
                  ativo
                    ? "bg-california-red/10 text-[#b3323c]"
                    : "bg-[#f1f0ec] text-muted-foreground",
                )}
              >
                {a.contagem}
              </span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className={cn(aba === "aguardando" ? "" : "hidden")}>
        <FilaAbertura linhas={fila} />
      </div>
      <div role="tabpanel" className={cn(aba === "abertos" ? "" : "hidden")}>
        <JobsAbertosList linhas={abertos} />
      </div>
    </div>
  );
}
