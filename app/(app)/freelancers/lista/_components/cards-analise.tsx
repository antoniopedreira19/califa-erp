"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type CategoriaCard = "na-ativa" | "em-dia" | "irregular" | "encerrados";

interface Card {
  key: CategoriaCard;
  label: string;
  descricao: string;
  tone: "emerald" | "ok" | "danger" | "muted";
}

const CARDS: Card[] = [
  {
    key: "na-ativa",
    label: "Na ativa",
    descricao: "Com vínculo em andamento",
    tone: "emerald",
  },
  {
    key: "em-dia",
    label: "Em dia",
    descricao: "Regular ou vencendo",
    tone: "ok",
  },
  {
    key: "irregular",
    label: "Irregular",
    descricao: "Precisa de atenção",
    tone: "danger",
  },
  {
    key: "encerrados",
    label: "Encerrados",
    descricao: "Sem vínculo ativo",
    tone: "muted",
  },
];

const TONE_STYLES: Record<Card["tone"], { bg: string; number: string; dot: string }> = {
  emerald: {
    bg: "bg-emerald-50/40",
    number: "text-emerald-700",
    dot: "bg-emerald-500",
  },
  ok: {
    bg: "bg-emerald-50/40",
    number: "text-emerald-700",
    dot: "bg-emerald-500",
  },
  danger: {
    bg: "bg-california-red/5",
    number: "text-california-red",
    dot: "bg-california-red",
  },
  muted: {
    bg: "bg-muted/30",
    number: "text-muted-foreground",
    dot: "bg-zinc-400",
  },
};

interface Props {
  totais: Record<CategoriaCard, number>;
}

export function CardsAnalise({ totais }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cardAtivo = searchParams.get("card");

  function alternarCard(key: CategoriaCard) {
    const params = new URLSearchParams(searchParams.toString());
    if (cardAtivo === key) {
      params.delete("card");
    } else {
      params.set("card", key);
    }
    const qs = params.toString();
    router.push(`/freelancers/lista${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {CARDS.map((c) => {
        const style = TONE_STYLES[c.tone];
        const ativo = cardAtivo === c.key;
        const n = totais[c.key] ?? 0;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => alternarCard(c.key)}
            className={cn(
              "group relative rounded-2xl border bg-white p-4 shadow-soft text-left transition-all hover:shadow-elevated hover:-translate-y-0.5",
              ativo ? "border-california-red" : "border-border",
            )}
          >
            <div className={cn("absolute inset-x-0 top-0 h-1 rounded-t-2xl", style.bg)} />
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full shrink-0", style.dot)} />
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground">
                {c.label}
              </span>
            </div>
            <p
              className={cn(
                "mt-2 text-4xl font-bold tracking-tight tabular-nums",
                style.number,
              )}
            >
              {n}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {c.descricao}
            </p>
          </button>
        );
      })}
    </div>
  );
}
