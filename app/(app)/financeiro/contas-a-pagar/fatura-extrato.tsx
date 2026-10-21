"use client";

/**
 * A tabela da fatura do cartão (decisão 093, entrega 2), na grade das
 * planilhas de títulos desde a decisão 197 (task 029): as MESMAS colunas e
 * larguras do Extrato da conciliação — Data · Crédito · Débito · Acumulado ·
 * Descrição · Fornecedor · Job · Centro de Custo · TRI · Empresa · REG ·
 * Ação —, `table-fixed` com `colgroup`, porque a fatura é o extrato da
 * conta-espelho recortado por fatura. Sem a coluna Situação.
 *
 * - O tipo do item (PP, avulso, recorrência, desembolso, estorno, ajuste) é a
 *   etiqueta embaixo da descrição, com o código da origem.
 * - O centro de custo mostra só o tipo; a dica, o centro inteiro.
 * - A Ação tem o ⓘ (o mesmo do Extrato), estornar a compra (crédito na
 *   fatura aberta) e ver a baixa registrada.
 * - A fatura paga fecha com a linha do pagamento: o crédito que zera o
 *   acumulado, de qual conta saiu, fora do DRE.
 *
 * A linha PENDENTE é o legado que ainda não virou lançamento: entra na
 * fatura no fechamento, e aparece esmaecida, com a marca — sem ela a soma
 * da tela não bateria com a faixa da fatura.
 */

import * as React from "react";
import Link from "next/link";
import { Eye, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dica } from "@/components/ui/dica";
import type { ItemDaFatura } from "@/lib/data/fatura-cartao-extrato";
import {
  colunasDoExtrato,
  derivarJobParaColuna,
  limparPrefixoDescricao,
  trimestreDe,
} from "@/app/(app)/financeiro/conciliacao/conciliacao-list";
import { BotaoDetalhes } from "@/components/financeiro/detalhes-do-titulo/botao-detalhes";
import { ITEM_TIPO } from "@/components/financeiro/planilha-de-titulos/planilha";
import { colunasDaFaturaNaGrade } from "@/components/financeiro/planilha-de-titulos/colunas";
import { textoDaRegional, type ItemDaFatura as TipoDoItem, type ParteDoRateio } from "@/lib/financeiro/planilha-de-titulos";
import type { TituloRow } from "./titulos-pagar-list";
import { limparDescricaoDaFatura } from "@/lib/cartoes/descricao-fatura";
import { BarraDosFiltrosDeColuna, useFiltrosDeColuna } from "@/components/ui/filtro-de-coluna";

/** As colunas que filtram e ordenam pelo título (pedido do Tiago,
 *  09/10/2026): as MESMAS da planilha da conciliação, com a descrição da
 *  fatura. Acumulado (o saldo corrente da fatura) e Ação ficam sem filtro —
 *  ver `colunasDoExtrato`. */
const COLUNAS = colunasDoExtrato<ItemDaFatura>({
  descricao: (l) => descricaoDaFatura(l.descricao, l.origem),
});

const GRADE = colunasDaFaturaNaGrade();

/** Os títulos mantêm a caixa da tabela (sem o espaçamento largo que o
 *  botão do filtro traz). */
const TITULO = "tracking-normal";

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

/** O pagamento da fatura paga, a última linha (decisão 197). */
export interface PagamentoDaFatura {
  data: string;
  /** "California Santander · Santander". */
  contaNome: string | null;
  valor: number;
  codigo: string;
  /** O banco do cartão, na coluna Fornecedor. */
  bancoDoCartao: string | null;
}

/** O tipo do item, pela etiqueta da planilha. */
function tipoDoItem(l: ItemDaFatura): TipoDoItem["tipo"] {
  if (l.papel === "ajuste") return "ajuste";
  if (l.natureza === "entrada") return "estorno";
  if (l.origem_item?.tipo === "pp") return "pp";
  if (l.origem_item?.tipo === "desembolso") return "desembolso";
  return l.origem_recorrente ? "recorrencia" : "avulso";
}

export function FaturaExtrato({
  itens,
  pagamento,
  titulosPorChave,
  onVerBaixa,
  onEstornarCompra,
  contexto = "",
}: {
  itens: ItemDaFatura[];
  /** A linha do pagamento, só na fatura paga. */
  pagamento: PagamentoDaFatura | null;
  /** O cartão e a competência: trocar de fatura zera os filtros dos
   *  títulos, porque os itens são outros (decisão 165). */
  contexto?: string;
  titulosPorChave: Map<string, TituloRow>;
  onVerBaixa: (t: TituloRow) => void;
  onEstornarCompra: (t: TituloRow) => void;
}) {
  const colunas = useFiltrosDeColuna(itens, COLUNAS, { guardarEm: "contas-a-pagar-cartao-fatura", contexto });

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
  const creditos = itens.reduce((s, l) => s + l.credito, 0);
  const debitos = itens.reduce((s, l) => s + l.debito, 0);
  // Com filtro, o rodapé soma o que sobrou (débitos − créditos, como o
  // acumulado), e diz "Total do filtro" — como a página inicial da
  // conciliação. Os quatro números de cima continuam os da fatura.
  const totalDoFiltro = colunas.visiveis.reduce((s, l) => s + l.debito - l.credito, 0);
  const creditosDoFiltro = colunas.visiveis.reduce((s, l) => s + l.credito, 0);
  const debitosDoFiltro = colunas.visiveis.reduce((s, l) => s + l.debito, 0);

  return (
    <>
    {colunas.ativo && (
      <BarraDosFiltrosDeColuna
        visiveis={colunas.visiveis.length}
        total={colunas.total}
        singular="item da fatura"
        plural="itens da fatura"
        onLimpar={colunas.limpar}
      />
    )}
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[1480px] table-fixed text-sm">
        <colgroup>
          {GRADE.map(([k, w]) => (
            <col key={k} style={w ? { width: w } : undefined} />
          ))}
        </colgroup>
        <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-3 text-left">{colunas.titulo("data", TITULO)}</th>
            <th className="px-3 py-3 text-right">{colunas.titulo("credito", TITULO)}</th>
            <th className="px-3 py-3 text-right">{colunas.titulo("debito", TITULO)}</th>
            {/* Acumulado: o saldo corrente da fatura — sem filtro e sem ordem. */}
            <th
              className="px-3 py-3 text-right font-semibold"
              title={
                colunas.ativo
                  ? "Acumulado da fatura: não muda com o filtro nem com a ordem dos títulos."
                  : "Débitos menos créditos, até a linha: é o que a fatura deve naquele ponto."
              }
            >
              Acumulado
            </th>
            <th className="px-3 py-3 text-left">{colunas.titulo("descricao", TITULO)}</th>
            <th className="px-3 py-3 text-left">{colunas.titulo("fornecedor", TITULO)}</th>
            <th className="px-3 py-3 text-left">{colunas.titulo("job", TITULO)}</th>
            <th className="px-3 py-3 text-left">{colunas.titulo("centro", TITULO)}</th>
            <th className="px-3 py-3 text-center">{colunas.titulo("trimestre", TITULO, "TRI")}</th>
            <th className="px-3 py-3 text-left">{colunas.titulo("empresa", TITULO)}</th>
            <th className="px-3 py-3 text-left">{colunas.titulo("reg", TITULO)}</th>
            <th className="px-3 py-3 text-center font-semibold">Ação</th>
          </tr>
        </thead>
        <tbody>
          {colunas.visiveis.length === 0 && (
            <tr>
              <td colSpan={GRADE.length} className="px-3 py-10 text-center text-sm text-muted-foreground">
                Nenhum item com esse filtro.
              </td>
            </tr>
          )}
          {colunas.visiveis.map((l) => {
            const pendente = l.papel === "pendente";
            const titulo = l.origem_item
              ? titulosPorChave.get(`${l.origem_item.tipo}:${l.origem_item.id}`) ?? null
              : null;
            const sobra = titulo ? sobraParaEstornar(titulo) : 0;
            const job = derivarJobParaColuna({ ...l, saldo: l.acumulado });
            const tipo = tipoDoItem(l);
            const centro = l.tipo_codigo ? `${l.tipo_codigo} · ${l.tipo_nome}` : null;
            const rateio: ParteDoRateio[] = l.regional_nome
              ? [{ regional: l.regional_nome, percentual: 100 }]
              : l.rateio.map((r) => ({ regional: r.regional_nome, percentual: r.percentual }));
            const reg = textoDaRegional(rateio);
            const descricao = descricaoDaFatura(l.descricao, l.origem);
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
                  <span className="block break-words">{descricao}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    <span
                      className={cn(
                        "inline-block rounded border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide",
                        ITEM_TIPO[tipo][1],
                      )}
                    >
                      {ITEM_TIPO[tipo][0]}
                    </span>
                    {l.origem_codigo && <span className="font-mono">{l.origem_codigo}</span>}
                    {pendente && (
                      <span
                        title="Roteado antes da decisão 093 (ou ajuste de fechamento reaberto): vira lançamento quando a fatura fechar."
                        className="inline-flex items-center rounded border border-[#fde68a] bg-[#fffbeb] px-1.5 py-px text-[9px] font-semibold uppercase text-[#92400e]"
                      >
                        entra no fechamento
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="block truncate" title={l.fornecedor_nome ?? undefined}>
                    {l.fornecedor_nome ?? <span className="text-muted-foreground">—</span>}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {job.tipo === "link" ? (
                    <Link
                      href={`/financeiro/jobs/${job.id}`}
                      prefetch={false}
                      className="block truncate text-california-red hover:underline"
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
                  {centro ? (
                    // Só o tipo, como na planilha de títulos; o centro
                    // inteiro na dica.
                    <Dica
                      conteudo={l.subtipo_nome && l.subtipo_nome !== "—" ? `${centro} · ${l.subtipo_nome}` : centro}
                      className="block w-full truncate"
                    >
                      {centro}
                    </Dica>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-xs text-muted-foreground">
                  {trimestreDe(l.data_movimento)}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="block truncate" title={l.empresa_nome ?? undefined}>
                    {l.empresa_nome ?? <span className="text-muted-foreground">—</span>}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {reg.texto === "—" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <Dica conteudo={reg.dica} className={cn(reg.rateado && "underline decoration-dotted underline-offset-2")}>
                      {reg.texto}
                    </Dica>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-2">
                  <span className="flex items-center justify-end gap-1.5">
                    {titulo && sobra > 0.005 && (
                      <button
                        type="button"
                        title={`Estornar esta compra (sobram ${formatMoney(sobra)})`}
                        aria-label="Estornar compra"
                        onClick={() => onEstornarCompra(titulo)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-emerald-600 hover:text-emerald-700"
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
                    {/* O pendente ainda não é lançamento: não tem ⓘ. */}
                    {!pendente && (
                      <BotaoDetalhes
                        chave={`lancamento|${l.id}`}
                        titulo={descricao}
                        rotulo="Ver detalhes do lançamento"
                        recebimento={l.natureza === "entrada"}
                        job={null}
                        vencimentoDiferente={null}
                        retencoes={[]}
                        rateio={rateio}
                        acoes={[]}
                      />
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
          {pagamento && !colunas.filtrando && (
            // O pagamento da fatura, a última linha (decisão 197): o crédito
            // que zera o acumulado. Fora do DRE — quem entra são os itens.
            <tr className="border-b border-border bg-emerald-50/40 text-xs">
              <td className="whitespace-nowrap px-3 py-2 font-mono">{formatDate(pagamento.data)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-emerald-700">
                {formatMoney(pagamento.valor)}
              </td>
              <td />
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold">
                {formatMoney(Math.round((total - pagamento.valor) * 100) / 100)}
              </td>
              <td className="px-3 py-2">
                <span className="block">Pagamento da fatura {pagamento.codigo}</span>
                {pagamento.contaNome && (
                  <span className="block text-[10.5px] text-muted-foreground">saiu da {pagamento.contaNome}</span>
                )}
              </td>
              <td className="px-3 py-2">
                <span className="block truncate">{pagamento.bancoDoCartao ?? "—"}</span>
              </td>
              <td className="px-3 py-2 italic text-muted-foreground/70">—</td>
              <td className="px-3 py-2 italic text-muted-foreground">
                <span className="block truncate" title="Pagamento de fatura · fora do DRE (decisão 084)">
                  Fora do DRE
                </span>
              </td>
              <td className="px-3 py-2 text-center font-mono text-muted-foreground">{trimestreDe(pagamento.data)}</td>
              <td className="px-3 py-2 text-muted-foreground">—</td>
              <td className="px-3 py-2 text-muted-foreground">—</td>
              <td />
            </tr>
          )}
        </tbody>
        <tfoot className="border-t-2 border-t-foreground bg-[#f3f2ee]">
          <tr className="text-xs">
            <td className="whitespace-nowrap px-3 py-2.5 font-semibold">
              {colunas.filtrando ? "Filtro" : "Total"}
            </td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-emerald-700">
              {(colunas.filtrando ? creditosDoFiltro : creditos) > 0
                ? formatMoney(colunas.filtrando ? creditosDoFiltro : creditos)
                : ""}
            </td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-california-red">
              {formatMoney(colunas.filtrando ? debitosDoFiltro : debitos)}
            </td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-sm font-bold">
              {formatMoney(colunas.filtrando ? totalDoFiltro : total)}
            </td>
            <td colSpan={GRADE.length - 4} className="px-3 py-2.5 text-muted-foreground">
              {colunas.filtrando
                ? `Total do filtro · ${colunas.visiveis.length} de ${itens.length} ${itens.length === 1 ? "item" : "itens"}`
                : `Total da fatura · ${itens.length} ${itens.length === 1 ? "item" : "itens"}`}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
    </>
  );
}

// "Cartão · " sai antes: só então "PP PP-00060 1/1" vira "PP-00060 1/1",
// como na conciliação.
function descricaoDaFatura(descricao: string, origem: string): string {
  return limparPrefixoDescricao(limparDescricaoDaFatura(descricao), origem);
}

/** A data com o ano inteiro, como no Extrato (decisão 195). */
function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
