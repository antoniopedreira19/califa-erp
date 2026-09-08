"use client";

import * as React from "react";
import { ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { chatAreaLabel } from "@/lib/types";
import type { ConversaPPs } from "@/lib/data/chat-pps-conversas";

/**
 * A caixa de entrada: uma linha por job que já mandou PP ao financeiro.
 *
 * Ordem e universo vêm prontos do servidor (decisão 058) — aqui só entra
 * o filtro da busca, que é local porque a lista inteira já está em mão
 * (12 jobs hoje) e ir ao servidor a cada tecla seria pior.
 */

function quando(iso: string): string {
  const d = new Date(iso);
  const agora = new Date();
  const mesmoDia =
    d.getDate() === agora.getDate() &&
    d.getMonth() === agora.getMonth() &&
    d.getFullYear() === agora.getFullYear();

  const dois = (n: number) => String(n).padStart(2, "0");
  if (mesmoDia) return `${dois(d.getHours())}:${dois(d.getMinutes())}`;
  if (d.getFullYear() === agora.getFullYear())
    return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}`;
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function ChatPPsLista({
  conversas,
  onAbrir,
}: {
  conversas: ConversaPPs[];
  onAbrir: (jobId: string) => void;
}) {
  const [busca, setBusca] = React.useState("");

  const filtradas = React.useMemo(() => {
    const termo = normalizar(busca.trim());
    if (!termo) return conversas;
    return conversas.filter((c) =>
      normalizar(
        `${c.jobCodigo} ${c.jobNome} ${c.contexto ?? ""}`,
      ).includes(termo),
    );
  }, [conversas, busca]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-none border-b border-border bg-white px-[18px] py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por job, cliente ou projeto…"
            aria-label="Buscar conversa por job, cliente ou projeto"
            className="w-full rounded-[10px] border border-border bg-white py-[9px] pl-9 pr-3 text-[12.5px] outline-none focus:border-california-red/40"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#FAFAFA]">
        {filtradas.length === 0 && (
          <div className="flex flex-1 items-center justify-center p-[18px]">
            <p className="max-w-[240px] text-center text-xs text-muted-foreground">
              {conversas.length === 0
                ? "Nenhum job mandou PP para o financeiro ainda. Quando a produção enviar a primeira, o chat dele aparece aqui."
                : "Nenhum job encontrado com esse termo."}
            </p>
          </div>
        )}

        {filtradas.map((c) => (
          <button
            key={c.jobId}
            type="button"
            onClick={() => onAbrir(c.jobId)}
            className="flex w-full items-start gap-2.5 border-b border-border bg-white px-[18px] py-3 text-left transition-colors hover:bg-california-red/[0.02]"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] font-semibold text-california-red">
                  {c.jobCodigo}
                </span>
                <span className="truncate text-[12.5px] font-semibold">
                  {c.jobNome}
                </span>
              </div>
              {c.contexto && (
                <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
                  {c.contexto}
                </p>
              )}
              <p
                className={cn(
                  "mt-1 truncate text-[11.5px] leading-[1.45]",
                  c.naoLidas > 0
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {c.ultimoTexto ? (
                  <>
                    <span className="text-muted-foreground">
                      {c.ultimoAutor ?? "—"}
                      {c.ultimaArea
                        ? ` (${chatAreaLabel(c.ultimaArea)})`
                        : ""}
                      {": "}
                    </span>
                    {c.ultimoTexto}
                  </>
                ) : (
                  <span className="italic text-muted-foreground">
                    Só PPs por aqui — ninguém escreveu ainda.
                  </span>
                )}
              </p>
            </div>

            <div className="flex flex-none flex-col items-end gap-1.5 pt-0.5">
              <span className="whitespace-nowrap text-[10.5px] text-muted-foreground">
                {quando(c.ultimaEm ?? c.ultimaPPEm)}
              </span>
              {c.naoLidas > 0 ? (
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-california-red px-1.5 text-[10px] font-bold text-white">
                  {c.naoLidas > 99 ? "99+" : c.naoLidas}
                </span>
              ) : (
                <ChevronRight className="h-[15px] w-[15px] text-[#c9c9c9]" />
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
