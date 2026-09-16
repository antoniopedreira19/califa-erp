"use client";

/**
 * Peças do envio para faturamento que o job normal e o mensal dividem
 * (decisão 087, 16/09/2026): o selo de situação e o pop-up "Ver envio".
 *
 * Nasceram dentro de `barra-faturamento-mensal.tsx` (decisão 078). Saíram
 * de lá quando o job normal ganhou o mesmo "Ver envio" — uma cópia por
 * modelo divergiria na primeira mudança, como as cores de bloco divergiram
 * antes de `_planilha/blocos.ts`.
 */

import * as React from "react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  EnvioDoJobComParcelas,
  NotaDoMes,
  SituacaoDoMes,
} from "@/lib/calculos/faturamento-por-mes";

export const SITUACAO_FATURAMENTO: Record<
  SituacaoDoMes,
  { rotulo: string; curto: string; classes: string }
> = {
  a_enviar: {
    rotulo: "A enviar",
    curto: "A enviar",
    classes: "border-border bg-muted text-muted-foreground",
  },
  na_fila: {
    rotulo: "Na fila do financeiro",
    curto: "Na fila",
    classes: "border-amber-200 bg-amber-50 text-amber-700",
  },
  faturado_parcial: {
    rotulo: "Faturado parcial",
    curto: "Parcial",
    classes: "border-blue-200 bg-blue-50 text-blue-700",
  },
  faturado: {
    rotulo: "Faturado",
    curto: "Faturado",
    classes: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  sem_faturamento: {
    rotulo: "Sem faturamento",
    curto: "Sem fatur.",
    classes: "border-dashed border-border bg-white text-muted-foreground",
  },
};

export function ChipSituacao({
  situacao,
  curto = false,
}: {
  situacao: SituacaoDoMes;
  curto?: boolean;
}) {
  const s = SITUACAO_FATURAMENTO[situacao];
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        s.classes,
      )}
    >
      {curto ? s.curto : s.rotulo}
    </span>
  );
}

/** "2026-10-20" → "20/10/2026". */
export function dataBr(iso: string): string {
  return iso.slice(0, 10).split("-").reverse().join("/");
}

/** "2026-10-20" → "20/10". */
export function diaMes(iso: string | null): string {
  if (!iso) return "—";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

/** Instante do envio no fuso de quem olha. */
export function dataDoEnvio(instante: string): string {
  return new Date(instante).toLocaleDateString("pt-BR");
}

export function listaPtBr(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * O pop-up "Ver envio". 640 px e a descrição da nota em letra de leitura
 * desde 16/09/2026: a descrição aceita até 2.000 caracteres, e nos 512 px
 * de antes um texto longo virava uma coluna estreita e comprida.
 */
export function VerEnvioFaturamentoDialog({
  aberto,
  onOpenChange,
  titulo,
  descricao,
  envio,
  situacao,
  notas,
  moeda,
}: {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  titulo: string;
  descricao: string;
  envio: EnvioDoJobComParcelas | null;
  situacao: SituacaoDoMes;
  notas: NotaDoMes[];
  moeda: string;
}) {
  return (
    <Dialog open={aberto && envio !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[640px] overflow-y-auto">
        {envio && (
          <>
            <DialogHeader>
              <DialogTitle>{titulo}</DialogTitle>
              <DialogDescription>{descricao}</DialogDescription>
            </DialogHeader>
            <dl className="space-y-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">Valor enviado</dt>
                <dd className="font-mono font-semibold">
                  {formatCurrency(envio.valor_faturado, moeda)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">Situação</dt>
                <dd>
                  <ChipSituacao situacao={situacao} />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">Número da PO</dt>
                <dd>{envio.numero_po ?? "—"}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">Portal</dt>
                <dd className="truncate">{envio.portal_url ?? "Sem portal"}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-muted-foreground">Descrição da nota fiscal</dt>
                <dd className="min-h-[120px] whitespace-pre-wrap rounded-lg border border-border bg-muted/30 px-3.5 py-3 text-sm leading-relaxed">
                  {envio.descricao_nf ?? "—"}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-muted-foreground">Parcelas</dt>
                <dd className="divide-y divide-border rounded-lg border border-border">
                  {envio.parcelas.map((par) => (
                    <div
                      key={par.id}
                      className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs"
                    >
                      <span className="font-mono text-muted-foreground">
                        {par.ordem}/{envio.parcelas.length}
                      </span>
                      <span className="font-mono font-semibold">
                        {formatCurrency(par.valor, moeda)}
                      </span>
                      <span>vence {dataBr(par.data_vencimento)}</span>
                    </div>
                  ))}
                </dd>
              </div>
              {notas.length > 0 && (
                <div className="space-y-1">
                  <dt className="text-muted-foreground">Notas emitidas</dt>
                  <dd className="text-xs">
                    {listaPtBr(
                      notas.map(
                        (nota) =>
                          `NF ${nota.numero ?? "—"} · ${formatCurrency(nota.valor, moeda)} (${diaMes(nota.dataEmissao)})`,
                      ),
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
