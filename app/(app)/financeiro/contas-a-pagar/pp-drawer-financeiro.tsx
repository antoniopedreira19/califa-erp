"use client";

/**
 * Formulário de avaliação da PP (aba "Pedidos de Produção").
 *
 * Reescrito na Tela 3.2. O que mudou e por quê:
 *
 * • O bloco "Ações do financeiro" (que só guardava o `prazo_pagamento_
 *   financeiro` num botão "Salvar prazo" à parte) virou um campo único e
 *   OBRIGATÓRIO: **Data de pagamento**, escolhida ANTES de aprovar. É ela
 *   que vira o vencimento dos títulos — e, numa PP parcelada, desloca
 *   TODAS as parcelas pelo mesmo delta.
 * • O **vencimento original** — o prazo que a produção negociou — ganhou
 *   destaque próprio: é a referência contra a qual o financeiro decide.
 * • "Ver PP" virou **"Visualizar documentos"**: PP e anexos lado a lado.
 * • Baixa e estorno saíram daqui. Baixa é da PARCELA e mora na aba
 *   "Títulos a Pagar"; o estorno foi retirado da UI por decisão do Tiago
 *   (17/08/2026), seguindo o protótipo. O código de estorno segue no
 *   repositório — ver `cancelar-baixa-modal.tsx` e `estornarBaixaPP`.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  X,
  FileText,
  Image as ImageIcon,
  CalendarClock,
  Columns2,
  Eye,
  Ban,
  CheckCircle2,
  ExternalLink,
  Lock,
  AlertCircle,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DrawerContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import { ppStatusLabel, type PPStatus } from "@/lib/types";
import type { PPRow } from "./pedidos-compra-list";
import { rejeitarPedidoCompraFinanceiro } from "./actions";
import { aprovarPPComData } from "./actions-titulos";
import { DocumentosPPOverlay } from "./documentos-pp-overlay";
import { PrestarContasDialog } from "./prestar-contas-dialog";
import { signedUrlAnexoPrestacao } from "./prestacao-verba-actions";

interface Props {
  pp: PPRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return format(parseISO(iso), "dd/MM/yyyy HH:mm");
}

function statusBadgeClasses(status: PPStatus): string {
  switch (status) {
    case "em_avaliacao":
      return "bg-[#fffbeb] text-[#92400e] border-[#fde68a]";
    case "aprovada":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "pago":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "rejeitada":
      return "bg-red-50 text-red-700 border-red-200";
    case "cancelada":
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function iconePorMime(nome: string): typeof FileText {
  const lower = nome.toLowerCase();
  if (/\.(png|jpe?g|webp)$/.test(lower)) return ImageIcon;
  return FileText;
}

export function PPDrawerFinanceiro({ pp, open, onOpenChange, tenantId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [dataPagamento, setDataPagamento] = React.useState<string>("");
  const [askRejeitar, setAskRejeitar] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [docsAbertos, setDocsAbertos] = React.useState(false);
  const [prestarOpen, setPrestarOpen] = React.useState(false);

  React.useEffect(() => {
    if (!pp) return;
    setDataPagamento("");
    setErro(null);
    setMotivo("");
    setDocsAbertos(false);
    setPrestarOpen(false);
  }, [pp]);

  async function abrirAnexo(anexo_id: string) {
    const res = await signedUrlAnexoPrestacao(anexo_id);
    if (res.ok) window.open(res.url, "_blank");
    else alert(res.message);
  }

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!pp) return null;

  // Só PP em avaliação aceita ação do financeiro. Aprovada, paga,
  // rejeitada ou cancelada viram leitura.
  const emAvaliacao = pp.status === "em_avaliacao";
  const hoje = format(new Date(), "dd/MM/yyyy");
  // O vencimento original que ancora o deslocamento é o da 1ª parcela —
  // o mesmo `prazo_pagamento` impresso no PDF.
  const vencOriginal = pp.parcelas[0]?.data_vencimento ?? pp.prazo_pagamento;

  function handleAprovar() {
    if (!pp) return;
    if (!dataPagamento) {
      setErro("Escolha a data de pagamento antes de aprovar.");
      return;
    }
    startTransition(async () => {
      const res = await aprovarPPComData({
        pp_id: pp.id,
        data_pagamento: dataPagamento,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setDocsAbertos(false);
      setToast(
        `${pp.codigo} aprovada · ${pp.parcelas.length > 1 ? `${pp.parcelas.length} títulos criados` : "título criado"} para ${formatDate(dataPagamento)}.`,
      );
      router.refresh();
      setTimeout(() => onOpenChange(false), 1200);
    });
  }

  function handleConfirmarRejeitar() {
    if (!pp) return;
    startTransition(async () => {
      const res = await rejeitarPedidoCompraFinanceiro(pp.id, motivo);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setAskRejeitar(false);
      setDocsAbertos(false);
      onOpenChange(false);
      setToast(`${pp.codigo} rejeitada. O GP foi liberado pra corrigir.`);
      router.refresh();
    });
  }

  const acoesAvaliacao = (
    <>
      <button
        type="button"
        onClick={() => setAskRejeitar(true)}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/40 bg-white px-3.5 py-2 text-sm font-semibold text-california-red transition-colors hover:bg-california-red/5 disabled:opacity-50"
      >
        <Ban className="h-3.5 w-3.5" />
        Rejeitar
      </button>
      <button
        type="button"
        onClick={handleAprovar}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        {pending ? "Aprovando..." : "Aprovar"}
      </button>
    </>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="sm:max-w-2xl">
          <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
            <DialogTitle className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-lg">{pp.codigo}</span>
              <Badge className={cn("border", statusBadgeClasses(pp.status))}>
                {ppStatusLabel(pp.status)}
              </Badge>
              <button
                type="button"
                onClick={() => setDocsAbertos(true)}
                className="ml-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold transition-colors hover:border-california-red hover:text-california-red"
              >
                <Columns2 className="h-3.5 w-3.5" />
                Visualizar documentos
              </button>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {erro && (
              <div className="flex items-start justify-between gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
                <span className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {erro}
                </span>
                <button type="button" onClick={() => setErro(null)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {pp.status === "cancelada" && (
              <div className="rounded-lg border border-california-red/30 bg-california-red/5 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-california-red">
                  Cancelada
                </p>
                <p className="text-sm">
                  Por <span className="font-medium">{pp.cancelada_por_nome ?? "—"}</span>{" "}
                  em {formatDateTime(pp.cancelada_em)}
                </p>
                <p className="mt-2 text-sm">
                  <span className="font-medium">Motivo: </span>
                  {pp.motivo_cancelamento ?? "Sem motivo registrado (cancelado pelo GP)."}
                </p>
              </div>
            )}

            {pp.status === "rejeitada" && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-red-700">
                  Rejeitada
                </p>
                <p className="text-sm">
                  Por <span className="font-medium">{pp.rejeitada_por_nome ?? "—"}</span>{" "}
                  em {formatDateTime(pp.rejeitada_em)}
                </p>
                <p className="mt-2 text-sm">
                  <span className="font-medium">Motivo: </span>
                  {pp.motivo_rejeicao ?? "—"}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Aguardando o gerente do job corrigir e reenviar.
                </p>
              </div>
            )}

            {pp.status === "pago" && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Paga
                </p>
                <p className="text-sm">
                  Última parcela baixada em {formatDate(pp.pago_em)}
                  {pp.pago_por_nome ? (
                    <>
                      , por <span className="font-medium">{pp.pago_por_nome}</span>
                    </>
                  ) : null}
                </p>
              </div>
            )}

            {/* Dados */}
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-4 text-sm">
              <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                <span className="text-muted-foreground">Fornecedor</span>
                <span className="font-medium">{pp.fornecedor_nome}</span>
                <span className="text-muted-foreground">Empresa emissora</span>
                <span>{pp.empresa_nome}</span>
                <span className="text-muted-foreground">Cliente</span>
                <span>{pp.cliente_nome ?? "—"}</span>
                <span className="text-muted-foreground">Projeto</span>
                <span>
                  <span className="font-mono text-xs">{pp.projeto_codigo}</span>{" "}
                  {pp.projeto_nome}
                </span>
                <span className="text-muted-foreground">Job</span>
                <span>
                  <Link
                    href={`/jobs/${pp.job_id}`}
                    prefetch={false}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-california-red hover:underline"
                  >
                    <span className="font-mono text-xs">{pp.job_codigo}</span>{" "}
                    {pp.job_nome}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </span>
                <span className="text-muted-foreground">Serviço</span>
                <span>{pp.servico}</span>
                <span className="text-muted-foreground">Quantidade</span>
                <span>{pp.quantidade}</span>
                <span className="text-muted-foreground">Parcela</span>
                <span className="font-mono text-xs">1/{Math.max(pp.parcelas.length, 1)}</span>
                <span className="text-muted-foreground">Valor</span>
                <span className="font-mono font-semibold">
                  {formatCurrency(pp.valor, "BRL")}
                </span>
                <span className="text-muted-foreground">Emitida em</span>
                <span>
                  {formatDate(pp.created_at)}
                  {pp.emitida_por_nome ? ` por ${pp.emitida_por_nome}` : ""}
                </span>
                {pp.especificacoes && (
                  <>
                    <span className="text-muted-foreground">Especificações</span>
                    <span className="whitespace-pre-wrap">{pp.especificacoes}</span>
                  </>
                )}
              </div>
            </div>

            {/* Vencimento original em evidência — é contra ele que a data
                de pagamento se decide, e é ele que fica registrado. */}
            <div className="flex items-center gap-3.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-amber-900/10 text-amber-800">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                  Vencimento original
                </p>
                <p className="mt-0.5 font-mono text-xl font-bold">
                  {formatDate(vencOriginal)}
                </p>
                <p className="mt-0.5 text-[11px] text-amber-900/70">
                  Prazo negociado pela produção com o fornecedor.
                </p>
              </div>
            </div>

            {/* Parcelas — leitura. Depois de aprovada, cada uma vira uma
                linha própria na aba "Títulos a Pagar". */}
            {pp.parcelas.length > 1 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Parcelas ({pp.parcelas.length})
                </h3>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {pp.parcelas.map((p) => (
                    <li
                      key={p.numero}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                    >
                      <span className="font-mono text-muted-foreground">
                        {p.numero}/{pp.parcelas.length}
                      </span>
                      <span className="text-muted-foreground">
                        vence em {formatDate(p.data_vencimento)}
                        {p.data_pagamento && p.data_pagamento !== p.data_vencimento && (
                          <> · paga em {formatDate(p.data_pagamento)}</>
                        )}
                      </span>
                      <span className="ml-auto font-mono font-semibold">
                        {formatCurrency(p.valor, "BRL")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Anexos */}
            {pp.anexos.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Anexos ({pp.anexos.length})
                </h3>
                <ul className="space-y-1">
                  {pp.anexos.map((a) => {
                    const Icon = iconePorMime(a.arquivo_nome_original);
                    return (
                      <li
                        key={a.id}
                        className="flex items-center gap-2 rounded border border-border bg-white p-2 text-xs"
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1 truncate">{a.arquivo_nome_original}</span>
                        <span className="text-muted-foreground">
                          {(a.arquivo_tamanho_bytes / 1024).toFixed(0)} KB
                        </span>
                        <button
                          type="button"
                          onClick={() => setDocsAbertos(true)}
                          className="text-california-red hover:opacity-70"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Prestação de contas — visível apenas para PPs de Verba de
                Produção. Exibe 3 estados: PP não paga (aviso), PP paga sem
                prestação (botão), prestação já feita (card readonly). */}
            {pp.verba_producao && (
              <section className="rounded-md border border-border p-4">
                <h3 className="text-sm font-semibold">Prestação de contas</h3>

                {pp.status !== "pago" && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    A prestação de contas só pode ser feita depois que a PP for totalmente paga.
                  </p>
                )}

                {pp.status === "pago" && !pp.prestacao && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setPrestarOpen(true)}
                      className="rounded-md bg-california-red px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover"
                    >
                      Prestar contas
                    </button>
                  </div>
                )}

                {pp.prestacao && (
                  <div className="mt-3 space-y-3 text-sm">
                    <p className="text-muted-foreground">
                      Fechada em {formatDate(pp.prestacao.fechada_em)}
                      {pp.prestacao.fechada_por_profile?.nome
                        ? ` por ${pp.prestacao.fechada_por_profile.nome}`
                        : ""}.
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded border border-border bg-muted/20 p-3 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor da PP</p>
                        <p className="mt-1 font-mono font-semibold">{formatMoney(pp.valor)}</p>
                      </div>
                      <div className="rounded border border-border bg-muted/20 p-3 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Gasto declarado</p>
                        <p className="mt-1 font-mono font-semibold">{formatMoney(pp.prestacao.valor_gasto)}</p>
                      </div>
                      <div className="rounded border border-border bg-muted/20 p-3 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Devolvido</p>
                        <p className="mt-1 font-mono font-semibold text-emerald-700">
                          {formatMoney(pp.prestacao.valor_devolvido)}
                        </p>
                      </div>
                    </div>
                    {pp.prestacao.anexos.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Notas fiscais anexadas
                        </p>
                        <ul className="space-y-1">
                          {pp.prestacao.anexos.map((a) => {
                            const Icon = iconePorMime(a.arquivo_nome_original);
                            return (
                              <li
                                key={a.id}
                                className="flex items-center gap-2 rounded border border-border bg-white p-2 text-xs"
                              >
                                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <button
                                  type="button"
                                  onClick={() => abrirAnexo(a.id)}
                                  className="flex-1 truncate text-left text-california-red underline hover:opacity-80"
                                >
                                  {a.arquivo_nome_original}
                                </button>
                                <span className="text-muted-foreground">
                                  {(a.arquivo_tamanho_bytes / 1024).toFixed(0)} KB
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* Data de pagamento — o campo que substituiu "Ações do
                financeiro". Obrigatório antes de aprovar. */}
            {emAvaliacao && (
              <div className="space-y-2 rounded-xl border border-border p-4">
                <p className="text-sm font-bold">
                  Data de pagamento <span className="text-california-red">*</span>
                </p>
                <p className="text-xs text-muted-foreground text-pretty">
                  Escolha antes de aprovar. Esta data vira o vencimento do título em
                  Títulos a Pagar; o vencimento original fica registrado.
                  {pp.parcelas.length > 1 && (
                    <>
                      {" "}
                      Como esta PP tem {pp.parcelas.length} parcelas, as demais são
                      deslocadas pelo mesmo número de dias.
                    </>
                  )}
                </p>
                <DatePicker
                  name="data_pagamento"
                  defaultValue={dataPagamento || undefined}
                  onDateChange={(d) => {
                    setDataPagamento(d ? format(d, "yyyy-MM-dd") : "");
                    setErro(null);
                  }}
                />
                <p className="text-[11px] text-muted-foreground">
                  Hoje é{" "}
                  <strong className="font-semibold text-california-red">{hoje}</strong> —
                  destacado no calendário.
                </p>
              </div>
            )}

            {!emAvaliacao && (
              <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-border px-4 py-3.5 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5 flex-none" />
                <span>
                  Esta PP já saiu da avaliação. Aprovação e rejeição ficam disponíveis
                  apenas para PPs em avaliação.
                </span>
              </div>
            )}
          </div>

          {emAvaliacao && (
            <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
              {acoesAvaliacao}
            </div>
          )}
        </DrawerContent>
      </Dialog>

      <DocumentosPPOverlay
        open={docsAbertos}
        onClose={() => setDocsAbertos(false)}
        ppId={pp.id}
        ppCodigo={pp.codigo}
        anexos={pp.anexos}
        rodape={
          emAvaliacao ? (
            <div className="flex flex-wrap items-center justify-end gap-2.5">
              <span className="mr-auto text-xs text-white/70">
                Data de pagamento:{" "}
                <strong className="font-semibold text-white">
                  {dataPagamento ? formatDate(dataPagamento) : "não escolhida"}
                </strong>{" "}
                · vencimento original {formatDate(vencOriginal)}
              </span>
              {acoesAvaliacao}
            </div>
          ) : undefined
        }
      />

      {/* Dialog de prestação de contas (só verba de produção paga) */}
      {pp.verba_producao && (
        <PrestarContasDialog
          open={prestarOpen}
          onOpenChange={setPrestarOpen}
          pp={{ id: pp.id, codigo: pp.codigo, valor: pp.valor, servico: pp.servico }}
          tenantId={tenantId}
          onSuccess={() => {
            setPrestarOpen(false);
            router.refresh();
          }}
        />
      )}

      {/* Confirm rejeitar */}
      <ConfirmDialog
        open={askRejeitar}
        onOpenChange={(o) => {
          setAskRejeitar(o);
          if (!o) setMotivo("");
        }}
        title={`Rejeitar ${pp.codigo}?`}
        description={
          <div className="space-y-2">
            <p>
              A PP volta pro gerente do job, que vê o motivo, corrige e reenvia para
              avaliação. O item continua reservado — não vira uma PP nova.
            </p>
            <div>
              <label className="text-xs font-medium">
                Motivo * (mín. 10 caracteres)
              </label>
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={500}
                rows={3}
                className="mt-1 w-full rounded border border-border p-2 text-sm"
                placeholder="Ex: valor 3,6% acima do planejado. Renegociar com o fornecedor ou anexar aprovação do cliente antes de reenviar."
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {motivo.trim().length}/500 caracteres
              </p>
            </div>
          </div>
        }
        confirmLabel="Confirmar rejeição"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={handleConfirmarRejeitar}
      />

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-[80] flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated animate-in fade-in slide-in-from-bottom-2"
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
    </>
  );
}
