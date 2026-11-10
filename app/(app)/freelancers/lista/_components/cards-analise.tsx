"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type CategoriaCard =
  | "em-dia"
  | "vencidos"
  | "sem-assinado"
  | "sem-minuta"
  | "vence-7d";

interface Card {
  key: CategoriaCard;
  label: string;
  descricao: string;
  tone: "ok" | "danger" | "warning" | "muted";
}

const CARDS: Card[] = [
  {
    key: "em-dia",
    label: "Em dia",
    descricao: "Regular ou vencendo",
    tone: "ok",
  },
  {
    key: "vencidos",
    label: "Contrato vencido",
    descricao: "Trabalhando sem renovação",
    tone: "danger",
  },
  {
    key: "sem-assinado",
    label: "Aguardando assinatura",
    descricao: "Minuta pronta, falta assinado",
    tone: "warning",
  },
  {
    key: "sem-minuta",
    label: "Sem minuta gerada",
    descricao: "Nada subido",
    tone: "muted",
  },
];

const TONE_STYLES: Record<
  Card["tone"],
  { bg: string; number: string; dot: string; borderAtivo: string }
> = {
  ok: {
    bg: "bg-emerald-50/40",
    number: "text-emerald-700",
    dot: "bg-emerald-500",
    borderAtivo: "border-emerald-500",
  },
  danger: {
    bg: "bg-california-red/5",
    number: "text-california-red",
    dot: "bg-california-red",
    borderAtivo: "border-california-red",
  },
  warning: {
    bg: "bg-amber-50/50",
    number: "text-amber-700",
    dot: "bg-amber-500",
    borderAtivo: "border-amber-500",
  },
  muted: {
    bg: "bg-muted/30",
    number: "text-muted-foreground",
    dot: "bg-zinc-400",
    borderAtivo: "border-zinc-400",
  },
};

interface Props {
  totais: Record<Exclude<CategoriaCard, "vence-7d">, number>;
  venceEm7Dias: number;
  totalEmAtividade: number;
}

export function CardsAnalise({
  totais,
  venceEm7Dias,
  totalEmAtividade,
}: Props) {
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
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-semibold tabular-nums text-foreground">
          {totalEmAtividade}
        </span>{" "}
        <span className="text-muted-foreground">freelancers em atividade</span>
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {CARDS.map((c) => {
          const style = TONE_STYLES[c.tone];
          const ativo = cardAtivo === c.key;
          const n = totais[c.key as Exclude<CategoriaCard, "vence-7d">] ?? 0;
          const ehEmDia = c.key === "em-dia";
          const vence7Ativo = ehEmDia && cardAtivo === "vence-7d";
          return (
            <div
              key={c.key}
              className={cn(
                "group relative rounded-2xl border bg-white shadow-soft transition-all",
                ativo || vence7Ativo
                  ? style.borderAtivo
                  : "border-border hover:shadow-elevated",
              )}
            >
              <button
                type="button"
                onClick={() => alternarCard(c.key)}
                className="w-full p-4 text-left"
              >
                <div
                  className={cn(
                    "absolute inset-x-0 top-0 h-1 rounded-t-2xl",
                    style.bg,
                  )}
                />
                <div className="flex items-center gap-2">
                  <span
                    className={cn("h-2 w-2 rounded-full shrink-0", style.dot)}
                  />
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

              {ehEmDia && (
                <button
                  type="button"
                  onClick={() => alternarCard("vence-7d")}
                  className={cn(
                    "w-full border-t px-4 py-2 text-left transition-colors rounded-b-2xl",
                    vence7Ativo
                      ? "border-amber-400 bg-amber-50 text-amber-800"
                      : venceEm7Dias > 0
                        ? "border-border bg-amber-50/40 text-amber-700 hover:bg-amber-50"
                        : "border-border bg-muted/20 text-muted-foreground",
                  )}
                >
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
                    {venceEm7Dias > 0 ? (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    {venceEm7Dias > 0
                      ? `${venceEm7Dias} vencem em 7 dias`
                      : "Nenhum vence em 7 dias"}
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
