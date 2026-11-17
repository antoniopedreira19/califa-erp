"use client";
// Peças pequenas do pedido de desembolso (decisão 264), nas classes das
// telas da PP: o selo de status, a linha de baixo do status, a dica ⓘ e os
// grupos e caixas da coluna Dados.
import * as React from "react";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ROTULO_DO_STATUS, type PedidoDeDesembolso, type StatusDoDesembolso } from "./tipos";

export const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dataBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
export const dataHoraBr = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }) : "—";
export const diaHoraCurto = (iso: string | null | undefined) =>
  iso
    ? new Date(iso)
        .toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
        .replace(",", "")
    : "—";

const TOM: Record<StatusDoDesembolso, string> = {
  em_avaliacao: "bg-[#fffbeb] text-[#92400e] border-[#fde68a]",
  aprovada: "bg-blue-50 text-blue-700 border-blue-200",
  pago: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejeitada: "bg-red-50 text-red-700 border-red-200",
  cancelada: "bg-slate-100 text-slate-500 border-slate-200",
};

export function SeloStatus({ status, className }: { status: StatusDoDesembolso; className?: string }) {
  return <Badge className={cn("whitespace-nowrap border", TOM[status], className)}>{ROTULO_DO_STATUS[status]}</Badge>;
}

/** A segunda linha da coluna Status: a data do que aconteceu (Tiago, 17/11: no rejeitado, só "Rejeitado <data>"). */
export function linhaDoStatus(d: PedidoDeDesembolso): string | null {
  if (d.status === "pago") return d.pagoEm ? `Pago ${dataBr(d.pagoEm)}` : null;
  if (d.status === "aprovada") return d.aprovado ? `Aprovado ${dataBr(d.aprovado.em)}` : null;
  if (d.status === "rejeitada") return d.rejeitado ? `Rejeitado ${dataBr(d.rejeitado.em)}` : null;
  if (d.status === "cancelada") return d.cancelado ? `Cancelado ${dataBr(d.cancelado.em)}` : null;
  if (d.status === "em_avaliacao" && d.reenviadoEm) return "Reenviado";
  return null;
}

export function Dica({ texto, className }: { texto: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-dica=""
          aria-label={texto}
          className={cn(
            "inline-flex h-4 w-4 flex-none items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none",
            className,
          )}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="z-[70] max-w-[300px] text-[11.5px] leading-relaxed">
        {texto}
      </TooltipContent>
    </Tooltip>
  );
}

export function Grupo({ rotulo, children, extra }: { rotulo: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {rotulo}
        {extra}
      </p>
      {children}
    </div>
  );
}

export function Caixa({ tom, titulo, children }: { tom: "vermelho" | "verde" | "ambar"; titulo: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 text-[11.5px] leading-relaxed",
        tom === "vermelho" ? "border-red-200 bg-red-50" : tom === "verde" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50",
      )}
    >
      <p
        className={cn(
          "mb-1 text-[10px] font-bold uppercase tracking-wider",
          tom === "vermelho" ? "text-red-700" : tom === "verde" ? "text-emerald-700" : "text-amber-800",
        )}
      >
        {titulo}
      </p>
      {children}
    </div>
  );
}

/** Os números 1, 2, 3… no cabeçalho do painel, como nos anexos da PP. */
export function NavegacaoDosAnexos({
  total,
  ativo,
  onAtivo,
  nomes,
}: {
  total: number;
  ativo: number;
  onAtivo: (i: number) => void;
  nomes: string[];
}) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: total }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onAtivo(i)}
          aria-pressed={i === ativo}
          title={nomes[i]}
          className={
            i === ativo
              ? "rounded-md bg-california-red px-2 py-0.5 text-[11px] font-semibold text-white"
              : "rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
          }
        >
          {i + 1}
        </button>
      ))}
    </div>
  );
}
