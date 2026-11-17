"use client";
// Contas a Pagar › Desembolsos (decisão 264): todos os pedidos, numa grade
// fixa com o que o financeiro precisa — valor, parcela, quem recebe, quem
// enviou, a regional e o pagamento. Sem botões na linha: o clique abre a
// tela do pedido, como a da PP, e lá se decide. Os urgentes que esperam o
// financeiro sobem para a seção "Urgentes", como na lista de PPs.
import * as React from "react";
import { cn } from "@/lib/utils";
import {
  BarraDosFiltrosDeColuna,
  celulaData,
  celulaTexto,
  celulaValor,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import type { TomadorDaNf } from "@/app/(app)/jobs/[jobId]/realizado/anexos-da-pp";
import { ROTULO_DO_STATUS, type PedidoDeDesembolso, type StatusDoDesembolso } from "@/app/(app)/financeiro/desembolsos/tipos";
import { SeloStatus, brl, dataBr, linhaDoStatus } from "@/app/(app)/financeiro/desembolsos/comum";
import { TelaDoDesembolso } from "@/app/(app)/financeiro/desembolsos/tela";

type Filtro = "em_avaliacao" | "aprovada" | "pago" | "rejeitada" | "cancelada" | "todos";
const ORDEM: StatusDoDesembolso[] = ["em_avaliacao", "aprovada", "pago", "rejeitada", "cancelada"];
const FILTROS: Array<{ key: Filtro; label: string }> = [
  { key: "em_avaliacao", label: "Em avaliação" },
  { key: "aprovada", label: "Aprovados" },
  { key: "pago", label: "Pagos" },
  { key: "rejeitada", label: "Rejeitados" },
  { key: "cancelada", label: "Cancelados" },
  { key: "todos", label: "Todos" },
];

const quemRecebe = (r: PedidoDeDesembolso) => (r.reembolso ? r.criador.nome : r.fornecedor?.nome ?? "—");

const COLUNAS: ColunaFiltravel<PedidoDeDesembolso>[] = [
  { chave: "codigo", rotulo: "Código", tipo: "texto", celula: (r) => ({ ...celulaTexto(r.codigo), busca: `${r.codigo} ${r.descricao}` }) },
  { chave: "valor", rotulo: "Valor", tipo: "valor", faixa: true, alinhar: "right", celula: (r) => celulaValor(r.valor, brl) },
  {
    chave: "parcela",
    rotulo: "Parcela",
    tipo: "valor",
    celula: (r) => {
      const n = Math.max(r.parcelas.length, 1);
      return { valor: String(n), rotulo: `1/${n}`, ordem: n };
    },
  },
  { chave: "descricao", rotulo: "Descrição", tipo: "texto", celula: (r) => celulaTexto(r.descricao) },
  { chave: "quem", rotulo: "Quem recebe", tipo: "texto", celula: (r) => celulaTexto(r.reembolso ? `Reembolso · ${r.criador.nome}` : quemRecebe(r)) },
  { chave: "enviado", rotulo: "Enviado por", tipo: "texto", celula: (r) => celulaTexto(r.criador.nome) },
  // Pedido do Tiago (17/11): a regional em coluna própria; com rateio, uma por linha da célula.
  { chave: "regional", rotulo: "Regional", tipo: "texto", celula: (r) => (r.regionais.length ? r.regionais.map((g) => celulaTexto(g.nome)) : celulaTexto(null)) },
  { chave: "pagamento", rotulo: "Pagamento", tipo: "data", celula: (r) => celulaData(r.prevista) },
  {
    chave: "status",
    rotulo: "Status",
    tipo: "texto",
    celula: (r) => ({ ...celulaTexto(ROTULO_DO_STATUS[r.status]), ordemNaLista: ORDEM.indexOf(r.status) }),
  },
];

export function DesembolsosContasPagarList({
  rows,
  cartoes,
  tomadores,
  abrirInicial = null,
}: {
  rows: PedidoDeDesembolso[];
  cartoes: CartaoOption[];
  tomadores: TomadorDaNf[];
  /** O `?abrir=` (o endereço antigo do detalhe redireciona para cá). */
  abrirInicial?: string | null;
}) {
  const [filtro, setFiltro] = React.useState<Filtro>(() =>
    abrirInicial && rows.some((r) => r.id === abrirInicial) ? "todos" : "em_avaliacao",
  );
  const [aberto, setAberto] = React.useState<string | null>(
    abrirInicial && rows.some((r) => r.id === abrirInicial) ? abrirInicial : null,
  );
  const conta = (k: Filtro) => (k === "todos" ? rows.length : rows.filter((l) => l.status === k).length);
  const doTopo = React.useMemo(() => (filtro === "todos" ? rows : rows.filter((l) => l.status === filtro)), [rows, filtro]);
  const colunas = useFiltrosDeColuna(doTopo, COLUNAS, { guardarEm: "contas-a-pagar-desembolsos" });
  const espera = (d: PedidoDeDesembolso) => d.urgente && (d.status === "em_avaliacao" || d.status === "aprovada");
  const urgentes = colunas.visiveis.filter(espera);
  const ordenadas = [...urgentes, ...colunas.visiveis.filter((d) => !espera(d))];
  const pedidoAberto = aberto ? rows.find((r) => r.id === aberto) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFiltro(f.key)}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              filtro === f.key
                ? "border-california-red bg-california-red text-white"
                : "border-border bg-white text-muted-foreground hover:border-california-red/50",
            )}
          >
            {f.label}
            <span className={cn("tabular-nums", filtro === f.key ? "text-white/85" : "text-muted-foreground/70")}>{conta(f.key)}</span>
          </button>
        ))}
      </div>
      {colunas.ativo && (
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="pedido"
          plural="pedidos"
          onLimpar={colunas.limpar}
        />
      )}
      <div className="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full min-w-[1440px] table-fixed text-sm">
          <colgroup>
            <col className="w-[116px]" />
            <col className="w-[132px]" />
            <col className="w-[92px]" />
            <col />
            <col className="w-[230px]" />
            <col className="w-[168px]" />
            <col className="w-[124px]" />
            <col className="w-[116px]" />
            <col className="w-[136px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">{colunas.titulo("codigo")}</th>
              <th className="px-4 py-3 text-right font-semibold">{colunas.titulo("valor")}</th>
              <th className="px-4 py-3 font-semibold">{colunas.titulo("parcela")}</th>
              <th className="px-4 py-3 font-semibold">{colunas.titulo("descricao")}</th>
              <th className="px-4 py-3 font-semibold">{colunas.titulo("quem")}</th>
              <th className="px-4 py-3 font-semibold">{colunas.titulo("enviado")}</th>
              <th className="px-4 py-3 font-semibold">{colunas.titulo("regional")}</th>
              <th className="px-4 py-3 font-semibold">{colunas.titulo("pagamento")}</th>
              <th className="px-4 py-3 font-semibold">{colunas.titulo("status")}</th>
            </tr>
          </thead>
          <tbody>
            {colunas.visiveis.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  Nenhum pedido de desembolso com esse filtro.
                </td>
              </tr>
            )}
            {ordenadas.map((d, i) => {
              const sub = linhaDoStatus(d);
              const pedido = d.parcelas[0]?.vencimento;
              const reprogramado = d.parcelas[0]?.dataPagamento && d.parcelas[0].dataPagamento !== pedido;
              return (
                <React.Fragment key={d.id}>
                  {i === 0 && urgentes.length > 0 && (
                    <tr className="border-b border-border bg-california-red/[0.07]">
                      <td
                        colSpan={9}
                        className="border-l-[3px] border-l-california-red px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-california-red"
                      >
                        Urgentes · {urgentes.length}
                      </td>
                    </tr>
                  )}
                  {i === urgentes.length && urgentes.length > 0 && (
                    <tr className="border-b border-border bg-muted/30">
                      <td colSpan={9} className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Demais pedidos
                      </td>
                    </tr>
                  )}
                  <tr
                    onClick={() => setAberto(d.id)}
                    title={d.urgente && d.justificativaUrgente ? `Urgente: ${d.justificativaUrgente}` : undefined}
                    className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/40"
                  >
                    <td className="px-4 py-3 align-top">
                      <p className="font-mono text-xs font-bold text-california-red">{d.codigo}</p>
                      {d.reembolso && (
                        <span className="mt-1 inline-block rounded-full border border-sky-200 bg-sky-50 px-1.5 py-px text-[10px] font-semibold uppercase text-sky-700">
                          Reembolso
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right align-top font-semibold tabular-nums">{brl(d.valor)}</td>
                    {/* Como na lista de PPs: "1/N", quantas vezes o financeiro vai
                        pagar; cada parcela vira uma linha em Títulos a Pagar. */}
                    <td className="px-4 py-3 align-top">
                      <span className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs font-semibold">
                        1/{Math.max(d.parcelas.length, 1)}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <p className="line-clamp-2 text-[13px] leading-snug" title={d.descricao}>
                        {d.descricao}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <p className="truncate text-[13px]" title={quemRecebe(d)}>
                        {quemRecebe(d)}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {d.reembolso ? "Reembolso a quem pediu" : d.fornecedor?.documento ?? ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <p className="truncate text-[13px]" title={d.criador.nome}>
                        {d.criador.nome}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{dataBr(d.enviadoEm)}</p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {d.regionais.length <= 1 ? (
                        <p className="truncate text-[13px]">{d.regionais[0]?.nome ?? "—"}</p>
                      ) : (
                        d.regionais.map((r) => (
                          <p key={r.id} className="truncate text-[12px] leading-snug">
                            {r.nome} <span className="text-muted-foreground">{r.pct.toLocaleString("pt-BR")}%</span>
                          </p>
                        ))
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-[13px] tabular-nums">
                      {dataBr(d.prevista)}
                      {reprogramado && <p className="text-[11px] text-amber-700">pedido {dataBr(pedido)}</p>}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <SeloStatus status={d.status} />
                      {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
                      {d.anexos.length === 0 && d.status === "em_avaliacao" && (
                        <p className="mt-1 text-[11px] font-semibold text-california-red">Sem comprovante</p>
                      )}
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <TelaDoDesembolso
        pedido={pedidoAberto}
        open={pedidoAberto !== null}
        onOpenChange={(o) => !o && setAberto(null)}
        financeiro
        tomadores={tomadores}
        cartoes={cartoes}
      />
    </div>
  );
}
