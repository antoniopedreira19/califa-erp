"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatTom, ItemChat } from "@/lib/types";
import { ICONE_COMPONENTE, ICONE_CORES, PILL_CORES } from "./icone-map";
import { BalaoPessoa } from "./balao-pessoa";

/**
 * O miolo do chat de PPs: cards automáticos de PP + balões de gente, na
 * ordem da thread.
 *
 * Mora aqui, e não dentro de `/jobs`, porque desde 08/09/2026 o mesmo fio
 * é lido de dois lugares — a aba PPs do job (um job só) e a caixa de
 * entrada do financeiro em Contas a Pagar (um chat por job). O pedido era
 * "o mesmo layout", e a única forma de isso continuar verdade daqui a
 * três meses é os dois renderizarem o MESMO componente.
 *
 * Quem carrega e quem envia continua sendo de cada lado: aqui só entra o
 * que já está montado.
 */

function classeValor(tom: ChatTom): string {
  switch (tom) {
    case "positivo":
      return "font-mono text-[11.5px] font-bold text-emerald-700";
    case "negativo":
      return "font-mono text-[11.5px] font-bold text-red-700";
    case "neutro":
      return "font-mono text-[11.5px] font-semibold text-foreground";
    case "texto":
      return "text-[11.5px] font-semibold text-foreground";
  }
}

export function ThreadPPs({
  itens,
  vazio,
}: {
  itens: ItemChat[];
  /** Texto do estado vazio — muda de tom conforme a tela. */
  vazio: React.ReactNode;
}) {
  const [abertas, setAbertas] = React.useState<Record<string, boolean>>({});
  const fimRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [itens.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto bg-[#FAFAFA] p-[18px]">
      {itens.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <p className="max-w-[240px] text-center text-xs text-muted-foreground">
            {vazio}
          </p>
        </div>
      )}
      {itens.map((item) =>
        item.tipo === "sistema" ? (
          <CardSistema
            key={item.id}
            item={item}
            aberto={!!abertas[item.id]}
            onAlternar={() =>
              setAbertas((p) => ({ ...p, [item.id]: !p[item.id] }))
            }
          />
        ) : (
          <BalaoPessoa key={item.id} item={item} />
        ),
      )}
      <div ref={fimRef} />
    </div>
  );
}

/**
 * Cards ficam fechados por default. Se o usuário quiser ver detalhes,
 * clica. Diferente do chat de Comunicação (que abre a última errata) —
 * aqui podem existir muitos cards de PP e abrir todos ocupa a thread.
 */
function CardSistema({
  item,
  aberto,
  onAlternar,
}: {
  item: Extract<ItemChat, { tipo: "sistema" }>;
  aberto: boolean;
  onAlternar: () => void;
}) {
  const Icone = ICONE_COMPONENTE[item.icone];
  return (
    <div className="flex-none overflow-hidden rounded-xl border border-[#e4e2dd] bg-white">
      <button
        type="button"
        onClick={onAlternar}
        className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-california-red/[0.02]"
      >
        <span
          className={cn(
            "inline-flex h-6 w-6 flex-none items-center justify-center rounded-[7px]",
            ICONE_CORES[item.cor],
          )}
        >
          <Icone className="h-[13px] w-[13px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[12.5px] font-semibold">{item.titulo}</span>
            <span className="text-[10.5px] text-muted-foreground">
              Automático · {item.quando}
            </span>
          </div>
          <p className="mt-1 text-xs leading-[1.45] text-muted-foreground">
            {item.resumo}
          </p>
        </div>
        {item.valor && (
          <span
            className={cn(
              "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-bold",
              PILL_CORES[item.valorTom],
            )}
          >
            {item.valor}
          </span>
        )}
        <ChevronRight
          className={cn(
            "h-[15px] w-[15px] flex-none text-[#c9c9c9] transition-transform",
            aberto && "rotate-90",
          )}
        />
      </button>

      {aberto && item.linhas.length > 0 && (
        <div className="flex flex-col gap-[9px] border-t border-border bg-[#f5f5f5]/50 px-3.5 py-3">
          {item.linhas.map((l, i) => (
            <div
              key={i}
              className="flex items-baseline gap-2 text-[11.5px] leading-[1.45]"
            >
              <span className="text-[#c9c9c9]">•</span>
              <span className="flex-1">{l.texto}</span>
              <span className={cn("whitespace-nowrap", classeValor(l.tom))}>
                {l.valor}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
