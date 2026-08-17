"use client";

/** Painel "Destrinchar realizado" — as PPs de UM item da planilha.
 *
 *  Design: `Job - PPs Parciais - Opcoes.dc.html`, opção **2a — Ficha
 *  numérica · sem gráfico** (as outras opções do arquivo foram
 *  descartadas pelo Tiago).
 *
 *  A leitura que o design pede é contábil e silenciosa: três números em
 *  fonte monoespaçada — Realizado do item, o que já está Em PPs emitidas
 *  e o Saldo — sem barra de progresso e sem cor de alerta. O saldo aqui
 *  é LIMITE para novas PPs, não meta a completar; por isso ele não
 *  "pede" para ser gasto, e quem avisa o teto é a nota embaixo do botão.
 *
 *  O bloco numérico tem altura fixa de propósito: item com 1 PP e item
 *  com 6 abrem exatamente igual.
 */

import * as React from "react";
import { X, FilePlus, Eye } from "lucide-react";
import { Dialog, DrawerContent } from "@/components/ui/dialog";
import { cn, formatCurrency } from "@/lib/utils";
import type { PPStatus } from "@/lib/types";
import { PPStatusChip } from "../pps/pp-status-chip";
import { signedUrlPdf } from "./actions-pp";

export interface PPDoItem {
  id: string;
  codigo: string;
  status: PPStatus;
  fornecedorNome: string;
  quantidade: number;
  valor: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemNome: string;
  grupoNome: string;
  moeda: string;
  /** Realizado do item — a base de tudo que o painel mostra. */
  totalRealizado: number;
  quantidadeRealizada: number;
  /** PPs do item, canceladas inclusive (elas aparecem, mas não somam). */
  pps: PPDoItem[];
  emPPs: number;
  saldo: number;
  /** Abre o formulário de PP. Null quando o usuário não pode emitir. */
  onNovaPP: (() => void) | null;
}

export function PainelPPsItem({
  open,
  onOpenChange,
  itemNome,
  grupoNome,
  moeda,
  totalRealizado,
  quantidadeRealizada,
  pps,
  emPPs,
  saldo,
  onNovaPP,
}: Props) {
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  const ativas = pps.filter((pp) => pp.status !== "cancelada");
  const fornecedoresDistintos = new Set(ativas.map((pp) => pp.fornecedorNome))
    .size;
  const unidadesEmPPs = ativas.reduce((s, pp) => s + pp.quantidade, 0);
  const unidadesSaldo = Math.max(quantidadeRealizada - unidadesEmPPs, 0);
  const semSaldo = saldo <= 0;

  function verPdf(ppId: string) {
    startTransition(async () => {
      const res = await signedUrlPdf(ppId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-[430px]">
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-[17px] font-bold tracking-tight">
              Destrinchar realizado
            </h2>
            <p className="text-[12.5px] text-muted-foreground">
              {itemNome} · grupo {grupoNome}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Fechar"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[9px] border border-border bg-card text-muted-foreground hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
          {erro && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2 text-xs text-california-red">
              <span>{erro}</span>
              <button type="button" onClick={() => setErro(null)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Ficha numérica — os três números do design. */}
          <div className="overflow-hidden rounded-[14px] border border-border bg-card">
            <div className="grid grid-cols-2">
              <FichaNumero
                rotulo="Realizado do item"
                valor={formatCurrency(totalRealizado, moeda)}
                detalhe={`${formatarQuantidade(quantidadeRealizada)} un · ${formatCurrency(
                  quantidadeRealizada > 0 ? totalRealizado / quantidadeRealizada : 0,
                  moeda,
                )}/un`}
                className="border-b border-r border-border"
              />
              <FichaNumero
                rotulo="Em PPs emitidas"
                valor={formatCurrency(emPPs, moeda)}
                detalhe={`${formatarQuantidade(unidadesEmPPs)} un · ${fornecedoresDistintos} ${
                  fornecedoresDistintos === 1 ? "fornecedor" : "fornecedores"
                }`}
                className="border-b border-border"
              />
            </div>
            <div className="flex items-baseline justify-between gap-2 bg-muted/30 px-4 py-3">
              <span className="text-[11.5px] font-semibold text-muted-foreground">
                Saldo
              </span>
              <span className="font-mono text-[13px] font-semibold text-foreground">
                {formatCurrency(saldo, moeda)}{" "}
                <span className="text-[11px] font-medium text-muted-foreground">
                  · {formatarQuantidade(unidadesSaldo)} un
                </span>
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              PPs deste item
            </span>

            {pps.length === 0 && (
              <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                Nenhuma PP emitida para este item ainda.
              </div>
            )}

            {pps.map((pp) => (
              <div
                key={pp.id}
                className={cn(
                  "flex flex-col gap-1.5 rounded-xl border border-border px-3.5 py-3",
                  pp.status === "cancelada" && "opacity-60",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                    {pp.codigo}
                  </span>
                  <PPStatusChip status={pp.status} />
                  <span className="ml-auto font-mono text-[13px] font-bold">
                    {formatCurrency(pp.valor, moeda)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2.5">
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    <strong className="font-semibold text-foreground">
                      {pp.fornecedorNome}
                    </strong>{" "}
                    · {formatarQuantidade(pp.quantidade)} un ·{" "}
                    {formatCurrency(
                      pp.quantidade > 0 ? pp.valor / pp.quantidade : 0,
                      moeda,
                    )}
                    /un
                  </span>
                  <button
                    type="button"
                    onClick={() => verPdf(pp.id)}
                    disabled={pending}
                    className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-border bg-card px-2 py-1 text-[11px] font-semibold hover:bg-muted disabled:opacity-50"
                  >
                    <Eye className="h-3 w-3 text-muted-foreground" />
                    Ver PP
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {onNovaPP && (
          <div className="flex flex-col gap-2 border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={onNovaPP}
              disabled={semSaldo}
              title={
                semSaldo
                  ? "O realizado deste item já está inteiro em PPs."
                  : undefined
              }
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-[13px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
            >
              <FilePlus className="h-3.5 w-3.5 text-california-red" />
              Nova PP para este item
            </button>
            <span className="text-[11px] leading-relaxed text-muted-foreground">
              Máximo aceito: {formatCurrency(Math.max(saldo, 0), moeda)} · acima
              disso é preciso alterar o realizado.
            </span>
          </div>
        )}
      </DrawerContent>
    </Dialog>
  );
}

/** Quantidade sem casas quando é inteira — "800", não "800,00". */
function formatarQuantidade(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(2).replace(".", ",");
}

function FichaNumero({
  rotulo,
  valor,
  detalhe,
  className,
}: {
  rotulo: string;
  valor: string;
  detalhe: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1 px-4 py-3.5", className)}>
      <span className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {rotulo}
      </span>
      <span className="font-mono text-[15px] font-bold">{valor}</span>
      <span className="text-[10.5px] text-muted-foreground">{detalhe}</span>
    </div>
  );
}
