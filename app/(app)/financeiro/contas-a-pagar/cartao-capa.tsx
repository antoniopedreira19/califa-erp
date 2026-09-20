"use client";

/**
 * A capa da aba Cartão (decisão 093, entrega 2): um cartão por card, com a
 * fatura em curso. Até cinco cartões, grade; de seis em diante, lista com
 * busca — a tela decide sozinha, pelo número de cartões. Oito cartões em
 * cards ocupam duas linhas e ~430px; com doze, a planilha some sem rolar.
 */

import * as React from "react";
import { ArrowRight, CreditCard, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";
import { lerCompetencia, rotuloCurto } from "@/lib/cartoes/competencia";
import type { CartaoDaCapa } from "./cartao-tab";

const LIMITE_GRADE = 5;

export function CartaoCapa({
  capa,
  pending,
  onAbrir,
  lancarPagamento,
}: {
  capa: CartaoDaCapa[];
  pending: boolean;
  onAbrir: (cartaoId: string) => void;
  lancarPagamento: React.ReactNode;
}) {
  const [busca, setBusca] = React.useState("");
  const [soAbertas, setSoAbertas] = React.useState(false);

  const totalAbertas = capa.reduce(
    (s, c) => s + (c.emCurso?.status === "aberta" ? c.emCurso.total : 0),
    0,
  );

  if (capa.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">{lancarPagamento}</div>
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <CreditCard className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Nenhum cartão de crédito ativo. Cadastre um em Configurações para
            as faturas aparecerem aqui.
          </p>
        </div>
      </div>
    );
  }

  const lista = capa.length > LIMITE_GRADE;
  const q = busca.trim().toLowerCase();
  const visiveis = capa.filter((c) => {
    if (soAbertas && c.emCurso?.status !== "aberta") return false;
    if (!q) return true;
    return (
      c.cartao.nome.toLowerCase().includes(q) ||
      c.cartao.banco.toLowerCase().includes(q) ||
      c.cartao.ultimos_4_digitos.includes(q)
    );
  });

  return (
    <div
      className={cn("space-y-4 transition-opacity", pending && "opacity-60")}
      aria-busy={pending || undefined}
    >
      <div className="flex flex-wrap items-center gap-3">
        {lista && (
          <>
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar cartão…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9"
              />
            </div>
            <button
              type="button"
              onClick={() => setSoAbertas((v) => !v)}
              className={cn(
                "rounded-lg border px-3 py-2 text-xs font-semibold transition-colors",
                soAbertas
                  ? "border-california-red bg-california-red text-white"
                  : "border-border bg-white text-muted-foreground hover:border-california-red/50",
              )}
            >
              Só com fatura aberta
            </button>
          </>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Total em faturas abertas{" "}
            <span className="font-mono text-sm font-semibold text-foreground">
              {formatCurrency(totalAbertas)}
            </span>
          </span>
          {lancarPagamento}
        </div>
      </div>

      {!lista ? (
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {visiveis.map((c) => (
            <CardCartao key={c.cartao.id} item={c} onAbrir={() => onAbrir(c.cartao.id)} />
          ))}
        </div>
      ) : visiveis.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          Nenhum cartão corresponde ao filtro.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left">Cartão</th>
                <th className="px-3 py-2.5 text-center">Competência</th>
                <th className="px-3 py-2.5 text-center">Status</th>
                <th className="px-3 py-2.5 text-right">Itens</th>
                <th className="px-3 py-2.5 text-right">Fatura em curso</th>
                <th className="w-24 px-3 py-2.5 text-center">Ação</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((c) => (
                <tr
                  key={c.cartao.id}
                  onClick={() => onAbrir(c.cartao.id)}
                  className="group cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/40"
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold">{c.cartao.nome}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {subtituloDoCartao(c)}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center font-mono text-xs">
                    {c.emCurso ? rotuloDaCompetencia(c.emCurso.competencia) : "—"}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {c.emCurso ? (
                      <ChipStatus status={c.emCurso.status} />
                    ) : (
                      <span className="text-xs text-muted-foreground">sem fatura</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs text-muted-foreground">
                    {c.emCurso ? `${c.emCurso.qtd_itens} ${c.emCurso.qtd_itens === 1 ? "item" : "itens"}` : "—"}
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-semibold">
                    {c.emCurso ? formatCurrency(c.emCurso.total) : "—"}
                  </td>
                  <td className="px-3 py-3 text-center text-xs font-semibold text-california-red">
                    <span className="inline-flex items-center gap-1">
                      Abrir <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        O item entra na fatura quando o pagamento é confirmado em Títulos a
        Pagar com forma &ldquo;cartão&rdquo;; a fatura fechada vira um título
        único lá, e é lá que a baixa dela acontece.
      </p>
    </div>
  );
}

function CardCartao({ item, onAbrir }: { item: CartaoDaCapa; onAbrir: () => void }) {
  const { cartao, emCurso } = item;
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="group flex flex-col rounded-2xl border border-border bg-card p-4 text-left shadow-soft transition-colors hover:border-california-red/60"
    >
      <span className="text-[14.5px] font-semibold">{cartao.nome}</span>
      <span className="mt-0.5 text-[11px] text-muted-foreground">
        {subtituloDoCartao(item)}
      </span>
      <span className="mt-3 font-mono text-xl font-semibold">
        {emCurso ? formatCurrency(emCurso.total) : "—"}
      </span>
      <span className="mt-3 flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
        {emCurso ? (
          <span className="inline-flex items-center gap-1.5">
            {rotuloDaCompetencia(emCurso.competencia)} · <ChipStatus status={emCurso.status} />
          </span>
        ) : (
          <span>sem fatura aberta</span>
        )}
        <span className="inline-flex items-center gap-1 font-semibold text-california-red">
          Abrir <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </button>
  );
}

export function ChipStatus({ status }: { status: "aberta" | "fechada" | "paga" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        status === "aberta" && "border-[#fde68a] bg-[#fffbeb] text-[#92400e]",
        status === "fechada" && "border-slate-300 bg-slate-100 text-slate-700",
        status === "paga" && "border-emerald-200 bg-emerald-50 text-emerald-700",
      )}
    >
      {status}
    </span>
  );
}

export function subtituloDoCartao(c: CartaoDaCapa): string {
  const partes = [
    `•••• ${c.cartao.ultimos_4_digitos}`,
    c.cartao.bandeira.toUpperCase(),
  ];
  if (c.cartao.dia_fechamento_fatura) partes.push(`fecha ${c.cartao.dia_fechamento_fatura}`);
  return partes.join(" · ");
}

function rotuloDaCompetencia(chave: string): string {
  const c = lerCompetencia(chave);
  return c ? rotuloCurto(c) : chave;
}
