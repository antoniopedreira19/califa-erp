"use client";

/**
 * A tabela da fatura do cartão (decisão 093, entrega 2): as MESMAS colunas
 * da conciliação — Data · Crédito · Débito · Acumulado · Descrição ·
 * Fornecedor · Job · Centro de Custo · Trimestre · Empresa · detalhes —,
 * porque a fatura é o extrato da conta-espelho recortado por fatura. O
 * popover de detalhes e as regras de coluna vêm da própria conciliação.
 *
 * Mais uma coluna, Ação: estornar a compra (crédito na fatura aberta) e
 * ver a baixa registrada (com estorno, se preciso). A linha PENDENTE é o
 * legado que ainda não virou lançamento: entra na fatura no fechamento, e
 * aparece esmaecida, com a marca — sem ela a soma da tela não bateria com
 * a faixa da fatura.
 */

import * as React from "react";
import Link from "next/link";
import { Eye, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ItemDaFatura } from "@/lib/data/fatura-cartao-extrato";
import {
  DetalhesPopover,
  derivarJobParaColuna,
  limparPrefixoDescricao,
  trimestreDe,
} from "@/app/(app)/financeiro/conciliacao/conciliacao-list";
import type { TituloRow } from "./titulos-pagar-list";
import { limparDescricaoDaFatura } from "@/lib/cartoes/descricao-fatura";

/** A chave que liga a linha do extrato ao título de onde ela veio. */
export function chaveDoTitulo(t: TituloRow): string | null {
  if (t.origem === "avulso" || t.origem === "recorrencia") return `avulso:${t.id}`;
  if (t.origem === "pp") return `pp:${t.id}`;
  if (t.origem === "desembolso") return `desembolso:${t.id}`;
  return null;
}

/** Quanto da COMPRA ainda cabe estornar — pelo total do grupo, não pela
 *  parcela: compra em 3x estornada é um crédito só (29/08/2026). */
export function sobraParaEstornar(t: TituloRow): number {
  if (t.estorno_de_avulsa_id) return 0;
  if (t.forma_pagamento !== "cartao_credito") return 0;
  return t.compra_total - t.estornado;
}

export function FaturaExtrato({
  itens,
  titulosPorChave,
  onVerBaixa,
  onEstornarCompra,
}: {
  itens: ItemDaFatura[];
  titulosPorChave: Map<string, TituloRow>;
  onVerBaixa: (t: TituloRow) => void;
  onEstornarCompra: (t: TituloRow) => void;
}) {
  if (itens.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Esta fatura ainda não tem item. Ele entra aqui quando um pagamento
          é confirmado em Títulos a Pagar com forma &ldquo;cartão&rdquo;.
        </p>
      </div>
    );
  }

  const total = itens.length ? itens[itens.length - 1].acumulado : 0;

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[1200px] text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Data</th>
            <th className="px-3 py-2 text-right">Crédito</th>
            <th className="px-3 py-2 text-right">Débito</th>
            <th className="px-3 py-2 text-right">Acumulado</th>
            <th className="px-3 py-2 text-left">Descrição</th>
            <th className="px-3 py-2 text-left">Fornecedor</th>
            <th className="px-3 py-2 text-left">Job</th>
            <th className="px-3 py-2 text-left">Centro de Custo</th>
            <th className="px-3 py-2 text-center">Trimestre</th>
            <th className="px-3 py-2 text-left">Empresa</th>
            <th className="w-10 px-3 py-2 text-center" aria-label="Detalhes" />
            <th className="w-20 px-2 py-2 text-center">Ação</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((l) => {
            const pendente = l.papel === "pendente";
            const titulo = l.origem_item
              ? titulosPorChave.get(`${l.origem_item.tipo}:${l.origem_item.id}`) ?? null
              : null;
            const sobra = titulo ? sobraParaEstornar(titulo) : 0;
            const job = derivarJobParaColuna({ ...l, saldo: l.acumulado });
            return (
              <tr
                key={l.id}
                className={cn(
                  "border-b border-border last:border-0 transition-colors hover:bg-muted/30",
                  pendente && "bg-muted/20 text-muted-foreground",
                )}
              >
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {formatDate(l.data_movimento)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-emerald-700">
                  {l.credito > 0 ? formatMoney(l.credito) : ""}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-california-red">
                  {l.debito > 0 ? formatMoney(l.debito) : ""}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs font-semibold">
                  {formatMoney(l.acumulado)}
                </td>
                <td className={cn("px-3 py-2 text-xs", l.estornada && "line-through")}>
                  {descricaoDaFatura(l.descricao, l.origem)}
                  {l.papel === "ajuste" && (
                    <span className="ml-1.5 inline-flex items-center rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-700">
                      ajuste
                    </span>
                  )}
                  {pendente && (
                    <span
                      title="Roteado antes da decisão 093 (ou ajuste de fechamento reaberto): vira lançamento quando a fatura fechar."
                      className="ml-1.5 inline-flex items-center rounded border border-[#fde68a] bg-[#fffbeb] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#92400e]"
                    >
                      entra no fechamento
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {l.fornecedor_nome ?? <span className="text-muted-foreground">—</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {job.tipo === "link" ? (
                    <Link
                      href={`/jobs/${job.id}?from=financeiro`}
                      prefetch={false}
                      className="text-california-red hover:underline"
                    >
                      {job.codigo}
                    </Link>
                  ) : job.tipo === "multi" ? (
                    <span className="font-sans italic text-muted-foreground/70">Múltiplos</span>
                  ) : (
                    <span className="font-sans italic text-muted-foreground/70">Não Vinculado</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className={pendente ? undefined : "text-foreground"}>{l.tipo_nome}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="text-muted-foreground">{l.subtipo_nome}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-xs text-muted-foreground">
                  {trimestreDe(l.data_movimento)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {l.empresa_nome ?? <span className="text-muted-foreground">—</span>}
                </td>
                <td className="w-10 px-3 py-2 text-center">
                  <DetalhesPopover
                    linha={{ ...l, saldo: l.acumulado }}
                    temSave={false}
                    temRateio={l.rateio.length > 1}
                    temOrigensMultiplas={false}
                  />
                </td>
                <td className="w-20 whitespace-nowrap px-2 py-2 text-center">
                  {titulo && sobra > 0.005 && (
                    <button
                      type="button"
                      title={`Estornar esta compra (sobram ${formatMoney(sobra)})`}
                      aria-label="Estornar compra"
                      onClick={() => onEstornarCompra(titulo)}
                      className="mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-emerald-600 hover:text-emerald-700"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {titulo && titulo.status === "pago" && (
                    <button
                      type="button"
                      title="Ver a baixa registrada — e estornar, se preciso"
                      aria-label="Ver baixa registrada"
                      onClick={() => onVerBaixa(titulo)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-2 border-border bg-muted/30">
          <tr>
            <td className="px-3 py-2.5 text-xs font-semibold" colSpan={3}>
              Total da fatura · {itens.length} {itens.length === 1 ? "item" : "itens"}
            </td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-sm font-bold">
              {formatMoney(total)}
            </td>
            <td colSpan={8} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// "Cartão · " sai antes: só então "PP PP-00060 1/1" vira "PP-00060 1/1",
// como na conciliação.
function descricaoDaFatura(descricao: string, origem: string): string {
  return limparPrefixoDescricao(limparDescricaoDaFatura(descricao), origem);
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
