"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { FilaAbertura, type FilaLinha } from "./fila-list";
import { JobsAbertosList } from "./jobs-abertos-list";
import { CalendarioJobs } from "./calendario-jobs";
import type { JobAberto } from "./dados-abertos";

export type Aba = "aguardando" | "abertos" | "calendario";

/**
 * As três abas da Abertura de Job: a fila do que ainda precisa ser
 * aberto, a lista do que já foi, e o calendário desse mesmo conjunto
 * (design "Calendário de Jobs", 07/09/2026).
 *
 * As listas descem prontas do server component e a aba é só estado de
 * tela — trocar de aba não refaz query. São dois SELECTs leves (a fila
 * costuma ter poucas linhas), carregados em paralelo, o que também mantém
 * as contagens do cabeçalho sempre verdadeiras.
 *
 * O calendário NÃO tem query própria de propósito: ele lê a mesma
 * `abertos` de "Visualizar Jobs". Duas leituras do mesmo conjunto
 * divergiriam no primeiro job que mudasse de status entre uma e outra, e
 * a pessoa veria contagens diferentes em duas abas da mesma tela.
 */
export function AberturaTabs({
  fila,
  abertos,
  hoje,
  abaInicial,
}: {
  fila: FilaLinha[];
  abertos: JobAberto[];
  /** "hoje" em `YYYY-MM-DD`, no fuso de Brasília, vindo do servidor. */
  hoje: string;
  /**
   * Aba pedida pela URL (`?aba=`). Quem volta da visão agregada ou do
   * detalhe de um job cai de novo em "Visualizar Jobs" — sem isso a
   * página escolhia sozinha e mandava para a fila, que não é de onde a
   * pessoa saiu.
   */
  abaInicial?: Aba;
}) {
  const [aba, setAba] = React.useState<Aba>(
    abaInicial ??
      // Sem `?aba=` na URL, a fila vazia é o estado normal do dia a dia:
      // abrir direto em "Visualizar Jobs" poupa um clique e evita receber
      // um empty state na cara.
      (fila.length > 0 ? "aguardando" : "abertos"),
  );

  /**
   * Mantém a URL contando em que aba a pessoa está, sem passar pelo
   * router: a página é `force-dynamic`, e um `router.replace` refaria
   * todas as queries só para trocar de aba. Assim o link continua
   * copiável e o voltar do navegador reabre a aba certa.
   */
  function irPara(nova: Aba) {
    setAba(nova);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("aba", nova);
      window.history.replaceState(null, "", url.toString());
    }
  }

  const abas: { key: Aba; rotulo: string; contagem: number | null }[] = [
    { key: "aguardando", rotulo: "Jobs aguardando abertura", contagem: fila.length },
    // "Visualizar Jobs", e não "Jobs abertos": esta aba é a porta de
    // entrada do job já aberto no financeiro — dela se chega ao registro
    // da abertura, à planilha, ao fluxo de caixa e à comunicação
    // (decisão do Tiago, 20/08/2026).
    { key: "abertos", rotulo: "Visualizar Jobs", contagem: abertos.length },
    // Sem contagem: o calendário mostra o MESMO conjunto da aba ao lado,
    // e repetir o número aqui só faria pensar que são coisas diferentes.
    // O design já traz esta aba sem badge.
    { key: "calendario", rotulo: "Calendário de Jobs", contagem: null },
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
              onClick={() => irPara(a.key)}
              className={cn(
                "mr-5 inline-flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-semibold transition-colors",
                ativo
                  ? "border-california-red text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {a.rotulo}
              {a.contagem !== null && (
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
              )}
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
      {/* O calendário só monta quando a aba é escolhida: ele varre a
          lista inteira por dia da grade, e manter isso rodando escondido
          atrás das outras duas abas custaria em toda visita à tela. */}
      {aba === "calendario" && (
        <div role="tabpanel">
          <CalendarioJobs linhas={abertos} hoje={hoje} />
        </div>
      )}
    </div>
  );
}
