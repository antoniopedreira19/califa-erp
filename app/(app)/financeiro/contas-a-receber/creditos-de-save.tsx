"use client";

/**
 * A aba "Créditos de save" (decisão 247): uma lista só, por cliente. O
 * cliente expande nas origens do save — os saves avulsos e os jobs que
 * geraram save —, e o ícone de cada origem abre o pop-up com os jobs que
 * consumiram. O consumo não ganha linha própria na lista (Tiago, 04/11/2026).
 */

import * as React from "react";
import { ChevronDown, ChevronRight, ListChecks, PiggyBank } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn, formatCurrency } from "@/lib/utils";
import type { ClienteComSave, OrigemDoCredito, SituacaoDoConsumo } from "./dados-creditos-de-save";

const brl = (n: number) => formatCurrency(n, "BRL");
const r2 = (n: number) => Math.round(n * 100) / 100;

const SITUACAO: Record<SituacaoDoConsumo, string> = {
  consumido: "Consumido",
  aguardando_financeiro: "Reservado · aguardando o financeiro",
  aguardando_abertura: "Reservado · aguardando abertura",
  rascunho: "Reservado · orçamento em rascunho",
};

const TH = "px-4 py-3 font-semibold";
const NUM = "px-4 py-3 text-right font-mono tabular-nums";

function Chip({ tipo }: { tipo: OrigemDoCredito["tipo"] }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-[1px] text-[10.5px] font-semibold",
        tipo === "avulso"
          ? "border-[#5f5d57]/30 bg-[#5f5d57]/10 text-[#3f3d39]"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {tipo === "avulso" ? "Save avulso" : "Save de job"}
    </span>
  );
}

function PopupDeConsumos({ origem, cliente, onFechar }: { origem: OrigemDoCredito | null; cliente: string; onFechar: () => void }) {
  const o = origem;
  return (
    <Dialog open={!!o} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-2xl">
        {o && (
          <>
            <DialogHeader>
              <DialogTitle>Onde o save foi consumido</DialogTitle>
              <DialogDescription>
                {o.nome} · {cliente}. Saldo de <strong className="font-mono text-foreground">{brl(o.saldo)}</strong> de{" "}
                {brl(o.credito)} de crédito.
              </DialogDescription>
            </DialogHeader>
            {o.consumos.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhum job consumiu este save ainda.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2.5 font-semibold">Job</th>
                      <th className="px-3 py-2.5 font-semibold">Linha</th>
                      <th className="px-3 py-2.5 font-semibold">Situação</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.consumos.map((c, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-2.5 font-medium">{c.consumidor}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{c.linha}</td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-[12px] font-semibold",
                            c.situacao === "consumido" ? "text-foreground" : "text-amber-700",
                          )}
                        >
                          {SITUACAO[c.situacao]}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">{brl(c.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CreditosDeSave({ clientes }: { clientes: ClienteComSave[] }) {
  const [abertos, setAbertos] = React.useState<Record<string, boolean>>({});
  const [popup, setPopup] = React.useState<{ origem: OrigemDoCredito; cliente: string } | null>(null);

  const somar = (os: OrigemDoCredito[], k: "credito" | "consumido" | "reservado" | "saldo") =>
    r2(os.reduce((s, o) => s + o[k], 0));
  const todas = clientes.flatMap((c) => c.origens);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Clientes com save: o gerado nos jobs e o save avulso, faturado sem job.</p>
      <div className="grid grid-cols-4 gap-3">
        {(
          [
            ["Crédito", somar(todas, "credito")],
            ["Consumido", somar(todas, "consumido")],
            ["Reservado", somar(todas, "reservado")],
            ["Saldo", somar(todas, "saldo")],
          ] as Array<[string, number]>
        ).map(([rotulo, valor]) => (
          <div key={rotulo} className="rounded-xl border border-border bg-card px-4 py-3 shadow-soft">
            <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">{rotulo}</p>
            <p className="mt-1 font-mono text-[17px] font-bold">{brl(valor)}</p>
          </div>
        ))}
      </div>

      {clientes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card py-12 text-sm text-muted-foreground">
          <PiggyBank className="h-6 w-6" />
          Nenhum cliente com save.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className={cn(TH, "w-[44px]")} />
                <th className={TH}>Cliente</th>
                <th className={TH}>Origem</th>
                <th className={cn(TH, "text-right")}>Crédito</th>
                <th className={cn(TH, "text-right")}>Consumido</th>
                <th className={cn(TH, "text-right")}>Reservado</th>
                <th className={cn(TH, "text-right")}>Saldo</th>
                <th className="w-[56px]" />
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => {
                const aberto = !!abertos[c.id];
                const reservado = somar(c.origens, "reservado");
                return (
                  <React.Fragment key={c.id}>
                    <tr
                      onClick={() => setAbertos((a) => ({ ...a, [c.id]: !a[c.id] }))}
                      className="cursor-pointer border-b border-border transition-colors hover:bg-accent/40"
                    >
                      <td className="pl-4 text-muted-foreground">
                        {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="px-4 py-3 font-semibold">{c.nome}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.origens.length === 1 ? "1 origem" : `${c.origens.length} origens`}
                      </td>
                      <td className={NUM}>{brl(somar(c.origens, "credito"))}</td>
                      <td className={NUM}>{brl(somar(c.origens, "consumido"))}</td>
                      <td className={cn(NUM, reservado > 0 && "text-amber-700")}>{brl(reservado)}</td>
                      <td className={cn(NUM, "font-bold")}>{brl(somar(c.origens, "saldo"))}</td>
                      <td />
                    </tr>
                    {aberto &&
                      c.origens.map((o) => (
                        <tr key={o.id} className="border-b border-border bg-muted/15">
                          <td />
                          <td className="py-2.5 pl-8 pr-4">
                            <Chip tipo={o.tipo} />
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="font-medium">{o.nome}</span>
                            <span className="text-[12px] text-muted-foreground"> · {o.detalhe}</span>
                          </td>
                          <td className={cn(NUM, "py-2.5")}>{brl(o.credito)}</td>
                          <td className={cn(NUM, "py-2.5")}>{brl(o.consumido)}</td>
                          <td className={cn(NUM, "py-2.5", o.reservado > 0 && "text-amber-700")}>{brl(o.reservado)}</td>
                          <td className={cn(NUM, "py-2.5 font-semibold")}>{brl(o.saldo)}</td>
                          <td className="pr-3 text-right">
                            <button
                              type="button"
                              onClick={() => setPopup({ origem: o, cliente: c.nome })}
                              title="Ver onde foi consumido"
                              aria-label="Ver onde foi consumido"
                              className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <ListChecks className="h-4 w-4" />
                              {o.consumos.length > 0 && (
                                <span className="absolute -right-1.5 -top-1.5 inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#5f5d57] px-1 text-[9.5px] font-bold text-white">
                                  {o.consumos.length}
                                </span>
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <PopupDeConsumos origem={popup?.origem ?? null} cliente={popup?.cliente ?? ""} onFechar={() => setPopup(null)} />
    </div>
  );
}
