"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { chatAreaLabel, type ItemChat } from "@/lib/types";

function iniciais(nome: string): string {
  return nome
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Balão de mensagem humana. Produção fica à direita, Financeiro à
 * esquerda — fixo por área pra thread ficar igual pros dois times.
 */
export function BalaoPessoa({
  item,
}: {
  item: Extract<ItemChat, { tipo: "pessoa" }>;
}) {
  const direita = item.area === "producao";
  return (
    <div
      className={cn(
        "flex flex-none items-start gap-[9px]",
        direita && "flex-row-reverse",
      )}
    >
      <div
        className={cn(
          "inline-flex h-7 w-7 flex-none items-center justify-center rounded-full text-[10.5px] font-bold text-white",
          direita ? "bg-california-red" : "bg-[#1e4fa3]",
        )}
      >
        {iniciais(item.autor)}
      </div>
      <div className="min-w-0 max-w-[80%]">
        <div
          className={cn(
            "mb-1 flex items-baseline gap-[7px]",
            direita && "flex-row-reverse",
          )}
        >
          <span className="text-[11.5px] font-semibold">{item.autor}</span>
          <span className="text-[10.5px] text-muted-foreground">
            {chatAreaLabel(item.area)} · {item.quando}
          </span>
        </div>
        <div
          className={cn(
            "rounded-xl border px-3 py-2.5 text-[12.5px] leading-[1.5]",
            direita
              ? "border-[#f3ced1] bg-[#fef5f5]"
              : "border-border bg-white",
          )}
        >
          {item.texto}
        </div>
      </div>
    </div>
  );
}
