"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, Eye, Pencil, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatCurrency } from "@/lib/utils";
import {
  podeCancelarPP,
  type PedidoCompraNaLista,
  type PedidoCompraParcela,
  type PPStatus,
} from "@/lib/types";
import { cancelarPedidoCompra, signedUrlPdf } from "../realizado/actions-pp";
import { PPStatusChip } from "./pp-status-chip";
import { EditarPPDrawer } from "./editar-pp-drawer";

interface Props {
  pps: PedidoCompraNaLista[];
  fornecedoresPorId: Record<string, string>;
  fornecedores: Array<{ id: string; nome: string; razao_social: string | null }>;
  empresas: Array<{ id: string; razao_social: string; principal: boolean }>;
  /** GP responsável pelo job ou admin, com o job em estado editável. */
  editable: boolean;
}

type Filtro = "todas" | PPStatus;

/** Uma linha da tabela = uma PARCELA de uma PP. `parcela: null` só
 *  acontece se o embed vier vazio — nenhuma PP fica sem parcela. */
interface LinhaPP {
  pp: PedidoCompraNaLista;
  parcela: PedidoCompraParcela | null;
  indice: number;
  total: number;
}

const CHIPS: Array<{ key: Filtro; label: string }> = [
  { key: "todas", label: "Todas" },
  { key: "em_avaliacao", label: "Em avaliação" },
  { key: "pago", label: "Pago" },
  { key: "rejeitada", label: "Rejeitado" },
  { key: "cancelada", label: "Cancelada" },
];

/** Largura reservada pra trilha de cancelar, fora do frame da tabela. */
const LARGURA_TRILHA = 104;

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * "30 dias": distância entre a emissão e o vencimento combinado. Não é
 * campo no banco — deriva de created_at e prazo_pagamento.
 */
function prazoEmDias(createdAt: string, prazoPagamento: string): string {
  const emissao = new Date(createdAt.slice(0, 10));
  const vencimento = new Date(prazoPagamento.slice(0, 10));
  const dias = Math.round(
    (vencimento.getTime() - emissao.getTime()) / 86_400_000,
  );
  if (!Number.isFinite(dias)) return "—";
  return `${dias} ${dias === 1 ? "dia" : "dias"}`;
}

export function JobPPsSection({
  pps,
  fornecedoresPorId,
  fornecedores,
  empresas,
  editable,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [filtro, setFiltro] = React.useState<Filtro>("todas");
  const [busca, setBusca] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [ppEditando, setPpEditando] = React.useState<PedidoCompraNaLista | null>(
    null,
  );
  const [ppCancelando, setPpCancelando] =
    React.useState<PedidoCompraNaLista | null>(null);

  // As linhas têm altura variável (o serviço quebra em 2-3 linhas conforme a
  // largura), então a trilha não pode assumir altura fixa: mede cada <tr> e
  // posiciona o botão correspondente no mesmo offset.
  const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
  const [linhas, setLinhas] = React.useState<
    Array<{ top: number; height: number }>
  >([]);
  /** Altura do cabeçalho: desce a trilha até o começo do tbody. */
  const [offsetThead, setOffsetThead] = React.useState(0);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const visiveis = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return pps.filter((pp) => {
      if (filtro !== "todas" && pp.status !== filtro) return false;
      if (!termo) return true;
      const fornecedor = fornecedoresPorId[pp.fornecedor_id] ?? "";
      return (
        pp.codigo.toLowerCase().includes(termo) ||
        pp.servico.toLowerCase().includes(termo) ||
        fornecedor.toLowerCase().includes(termo)
      );
    });
  }, [pps, filtro, busca, fornecedoresPorId]);

  /**
   * Uma linha por PARCELA (decisão do Tiago, 17/08/2026): cada parcela é
   * um vencimento próprio, e é assim que o financeiro vai tratá-la. PP
   * sem parcelamento tem uma parcela 1/1 e continua ocupando uma linha
   * só — visualmente nada mudou para ela.
   *
   * PP legada sem parcela não existe (a migration backfillou todas), mas
   * o fallback evita sumir com a linha caso o embed venha vazio.
   */
  const linhasVisiveis = React.useMemo<LinhaPP[]>(
    () =>
      visiveis.flatMap((pp): LinhaPP[] => {
        const parcelas = pp.parcelas ?? [];
        if (parcelas.length === 0) {
          return [{ pp, parcela: null, indice: 0, total: 1 }];
        }
        return parcelas.map((parcela, i) => ({
          pp,
          parcela,
          indice: i,
          total: parcelas.length,
        }));
      }),
    [visiveis],
  );

  React.useLayoutEffect(() => {
    const tbody = tbodyRef.current;
    if (!tbody) return;

    const medir = () => {
      const base = tbody.getBoundingClientRect().top;
      const cardTop =
        tbody.closest("table")?.getBoundingClientRect().top ?? base;
      setOffsetThead(base - cardTop);
      setLinhas(
        Array.from(tbody.rows).map((tr) => {
          const r = tr.getBoundingClientRect();
          return { top: r.top - base, height: r.height };
        }),
      );
    };

    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(tbody);
    const tabela = tbody.closest("table");
    if (tabela) observer.observe(tabela);
    return () => observer.disconnect();
  }, [linhasVisiveis]);

  // Cards de resumo ignoram canceladas: PP cancelada não é PP gerada, é
  // uma que deixou de existir pro job.
  const ativas = pps.filter((p) => p.status !== "cancelada");
  const resumo = {
    geradas: ativas.length,
    emAvaliacao: ativas.filter((p) => p.status === "em_avaliacao").length,
    pagas: ativas.filter((p) => p.status === "pago").length,
    total: ativas.reduce((s, p) => s + Number(p.valor ?? 0), 0),
  };

  function handleVer(pp: PedidoCompraNaLista) {
    startTransition(async () => {
      const res = await signedUrlPdf(pp.id);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  function handleCancelarConfirm() {
    if (!ppCancelando) return;
    const codigo = ppCancelando.codigo;
    startTransition(async () => {
      const res = await cancelarPedidoCompra(ppCancelando.id);
      setPpCancelando(null);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setToast(`${codigo} cancelada.`);
      router.refresh();
    });
  }

  if (pps.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum Pedido de Produção gerado neste job ainda.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          As PPs são geradas pela aba Planilha Interna, a partir dos itens com
          valor realizado lançado.
        </p>
      </div>
    );
  }

  return (
    // Reserva a calha da direita pra trilha de cancelar, que fica fora do
    // frame da tabela — sem ela os botões eram cortados na borda da página.
    <div className={cn("space-y-3.5", editable && "pr-[114px]")}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CardResumo rotulo="PPs geradas" valor={String(resumo.geradas)} />
        <CardResumo
          rotulo="Em avaliação"
          valor={String(resumo.emAvaliacao)}
          cor="text-[#92400e]"
        />
        <CardResumo
          rotulo="Pagas"
          valor={String(resumo.pagas)}
          cor="text-emerald-700"
        />
        <CardResumo
          rotulo="Total em PPs"
          valor={formatCurrency(resumo.total, "BRL")}
          mono
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFiltro(c.key)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[11.5px] font-semibold transition-colors",
              filtro === c.key
                ? "border-california-red bg-california-red text-white"
                : "border-border bg-white text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código, item ou fornecedor"
            className="h-8 w-[270px] rounded-lg border border-border bg-white pl-8 pr-3 text-xs outline-none focus:border-california-red/40"
          />
        </div>
      </div>

      {erro && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-california-red/30 bg-california-red/5 px-4 py-2 text-xs text-california-red">
          <span>{erro}</span>
          <button type="button" onClick={() => setErro(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="relative">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-[13px]">
              <colgroup>
                <col className="w-[11%]" />
                <col />
                <col className="w-[15%]" />
                <col className="w-[13%]" />
                <col className="w-[9%]" />
                <col className="w-[11%]" />
                <col className="w-[13%]" />
                <col className="w-[9%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-muted/50 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-3.5 py-2.5 text-left">Código</th>
                  <th className="px-3.5 py-2.5 text-left">Serviço · item do job</th>
                  <th className="px-3.5 py-2.5 text-left">Fornecedor</th>
                  <th className="px-3.5 py-2.5 text-left">Vencimento</th>
                  <th className="px-3.5 py-2.5 text-left">Prazo</th>
                  <th className="px-3.5 py-2.5 text-right">Valor</th>
                  <th className="px-3.5 py-2.5 text-left">Status</th>
                  <th className="px-3.5 py-2.5" />
                </tr>
              </thead>
              <tbody ref={tbodyRef}>
                {linhasVisiveis.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      Nenhuma PP com esse filtro.
                    </td>
                  </tr>
                )}
                {linhasVisiveis.map(({ pp, parcela, indice, total }) => {
                  const vencimento = parcela?.data_vencimento ?? pp.prazo_pagamento;
                  const valorLinha = parcela
                    ? Number(parcela.valor)
                    : Number(pp.valor);
                  return (
                  <tr
                    key={parcela?.id ?? pp.id}
                    className={cn(
                      "h-[57px] border-b border-border/60 last:border-0",
                      pp.status === "cancelada" && "opacity-60",
                    )}
                  >
                    <td className="whitespace-nowrap px-3.5 font-mono text-[11.5px]">
                      {pp.codigo}
                      {total > 1 && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {indice + 1}/{total}
                        </span>
                      )}
                    </td>
                    <td className="px-3.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[13px] font-semibold">
                          {pp.servico}
                        </span>
                        <span className="text-[11.5px] text-muted-foreground">
                          {pp.grupo_nome ? `${pp.grupo_nome} · ` : ""}
                          emitida em {formatarData(pp.created_at)}
                          {pp.emitida_por_nome ? ` por ${pp.emitida_por_nome}` : ""}
                          {total > 1
                            ? ` · ${formatCurrency(Number(pp.valor), "BRL")} em ${total}x`
                            : ""}
                        </span>
                      </div>
                    </td>
                    <td className="px-3.5 text-muted-foreground">
                      {fornecedoresPorId[pp.fornecedor_id] ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3.5 font-mono text-xs">
                      {formatarData(vencimento)}
                    </td>
                    <td className="whitespace-nowrap px-3.5 text-muted-foreground">
                      {prazoEmDias(pp.created_at, vencimento)}
                    </td>
                    <td className="whitespace-nowrap px-3.5 text-right font-mono text-[12.5px] font-semibold">
                      {formatCurrency(valorLinha, "BRL")}
                    </td>
                    <td className="px-3.5">
                      <PPStatusChip status={pp.status} />
                    </td>
                    <td className="px-3.5">
                      {/* Editar e Ver PDF são da PP inteira, então só a
                          primeira parcela os mostra — repetir em cada
                          linha sugeriria ação por parcela, que só existe
                          a partir da Tela 3.2. */}
                      <div className={cn("flex items-center justify-end gap-1.5", indice > 0 && "invisible")}>
                        {editable && pp.status === "rejeitada" && (
                          <button
                            type="button"
                            onClick={() => setPpEditando(pp)}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-california-red/25 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-california-red hover:bg-california-red/[0.06]"
                          >
                            <Pencil className="h-3 w-3" />
                            Editar
                          </button>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => handleVer(pp)}
                              disabled={pending}
                              className="inline-flex items-center justify-center rounded-lg border border-border bg-white p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Ver PDF · {pp.codigo}</TooltipContent>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cancelar mora fora do frame, igual "Ver PP" / "Gerar PP" da
            Planilha Interna. Só aparece pra PP que ainda dá pra cancelar. */}
        {editable && (
          <div
            className="absolute left-full ml-2.5"
            style={{ width: LARGURA_TRILHA, top: offsetThead }}
          >
            {linhasVisiveis.map(({ pp, parcela, indice }, i) => {
              const pos = linhas[i];
              // Cancelar é da PP inteira: só na linha da 1ª parcela.
              if (!pos || indice > 0 || !podeCancelarPP(pp.status)) return null;
              return (
                <div
                  key={parcela?.id ?? pp.id}
                  className="absolute inset-x-0 flex items-center"
                  style={{ top: pos.top, height: pos.height }}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setPpCancelando(pp)}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-white px-2.5 py-1 text-[11px] font-semibold text-california-red transition-colors hover:border-california-red/30 hover:bg-california-red/[0.06] disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Cancelar
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Cancelar {pp.codigo}</TooltipContent>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={ppCancelando !== null}
        onOpenChange={(o) => !o && setPpCancelando(null)}
        title="Cancelar Pedido de Produção?"
        description={
          <>
            <strong className="text-foreground">{ppCancelando?.codigo}</strong>{" "}
            será cancelada e o item volta a permitir a geração de uma nova PP. O
            PDF e os anexos ficam guardados no histórico.
          </>
        }
        confirmLabel="Cancelar PP"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={handleCancelarConfirm}
      />

      <EditarPPDrawer
        open={ppEditando !== null}
        onOpenChange={(o) => !o && setPpEditando(null)}
        pp={ppEditando}
        fornecedores={fornecedores}
        empresas={empresas}
        onSuccess={(codigo) =>
          setToast(`${codigo} corrigida e reenviada para avaliação.`)
        }
      />

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated"
        >
          <span className="text-sm font-medium text-emerald-800">{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function CardResumo({
  rotulo,
  valor,
  cor,
  mono,
}: {
  rotulo: string;
  valor: string;
  cor?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3.5 shadow-soft">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {rotulo}
      </span>
      <strong
        className={cn("text-[22px] font-bold", mono && "font-mono text-lg", cor)}
      >
        {valor}
      </strong>
    </div>
  );
}
