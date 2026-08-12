"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  X,
  FileText,
  Image as ImageIcon,
  Download,
  Eye,
  Ban,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DrawerContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import { ppStatusLabel, type PPStatus } from "@/lib/types";
import type { PPRow } from "./pedidos-compra-list";
import {
  salvarPrazoFinanceiro,
  rejeitarPedidoCompraFinanceiro,
  aprovarPP,
} from "./actions";
import {
  signedUrlPdf,
  signedUrlAnexo,
} from "@/app/(app)/jobs/[jobId]/realizado/actions-pp";
import { CancelarBaixaModal } from "./cancelar-baixa-modal";

interface Props {
  pp: PPRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

function isoDateFromDate(date: Date | null): string | null {
  return date ? format(date, "yyyy-MM-dd") : null;
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

function iconePorMime(nome: string): typeof FileText {
  const lower = nome.toLowerCase();
  if (/\.(png|jpe?g|webp)$/.test(lower)) return ImageIcon;
  return FileText;
}

export function PPDrawerFinanceiro({ pp, open, onOpenChange }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [prazoLocal, setPrazoLocal] = React.useState<string | null>(null);
  const [askRejeitar, setAskRejeitar] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [cancelarBaixaOpen, setCancelarBaixaOpen] = React.useState(false);

  // Sincroniza prazo local com o valor da PP ao abrir/trocar
  React.useEffect(() => {
    if (!pp) return;
    setPrazoLocal(pp.prazo_pagamento_financeiro);
    setErro(null);
    setMotivo("");
    setCancelarBaixaOpen(false);
  }, [pp]);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!pp) return null;

  // Só PP em avaliação aceita ação do financeiro. Paga, rejeitada ou
  // cancelada viram leitura — o próximo passo é do GP ou de outra fase.
  const podeEditar = pp.status === "em_avaliacao";
  const prazoMudou = prazoLocal !== pp.prazo_pagamento_financeiro;

  function handleVerPDF() {
    if (!pp) return;
    startTransition(async () => {
      const res = await signedUrlPdf(pp.id);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  function handleBaixarAnexo(anexoId: string) {
    startTransition(async () => {
      const res = await signedUrlAnexo(anexoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  function handleSalvarPrazo() {
    if (!pp) return;
    startTransition(async () => {
      const res = await salvarPrazoFinanceiro(pp.id, prazoLocal);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setToast("Prazo financeiro salvo!");
      router.refresh();
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
      onOpenChange(false);
      setToast(`${pp.codigo} rejeitada. O GP foi liberado pra corrigir.`);
      router.refresh();
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="sm:max-w-2xl">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
            <DialogTitle className="flex items-center gap-3">
              <span className="font-mono text-lg">{pp.codigo}</span>
              <Badge className={cn("border", statusBadgeClasses(pp.status))}>
                {ppStatusLabel(pp.status)}
              </Badge>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleVerPDF}
                    disabled={pending}
                    className="ml-auto rounded-md p-1.5 text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Ver PDF</TooltipContent>
              </Tooltip>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 p-6">
            {erro && (
              <div className="flex items-start justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
                <span>{erro}</span>
                <button type="button" onClick={() => setErro(null)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {pp.status === "cancelada" && (
              <div className="rounded-lg border border-california-red/30 bg-california-red/5 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-california-red mb-1">
                  Cancelada
                </p>
                <p className="text-sm">
                  Por{" "}
                  <span className="font-medium">
                    {pp.cancelada_por_nome ?? "—"}
                  </span>{" "}
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
                  Por{" "}
                  <span className="font-medium">
                    {pp.rejeitada_por_nome ?? "—"}
                  </span>{" "}
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
                  Em {formatDate(pp.pago_em)}
                  {pp.pago_por_nome ? (
                    <>
                      , registrado por{" "}
                      <span className="font-medium">{pp.pago_por_nome}</span>
                    </>
                  ) : null}
                </p>
              </div>
            )}

            {/* Dados */}
            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2 text-sm">
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
                    className="text-california-red hover:underline inline-flex items-center gap-1"
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
                <span className="text-muted-foreground">Valor</span>
                <span className="font-mono font-semibold">
                  {formatCurrency(pp.valor, "BRL")}
                </span>
                <span className="text-muted-foreground">Prazo Original</span>
                <span>{formatDate(pp.prazo_pagamento)}</span>
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

            {/* Anexos */}
            {pp.anexos.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
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
                        <span className="flex-1 truncate">
                          {a.arquivo_nome_original}
                        </span>
                        <span className="text-muted-foreground">
                          {(a.arquivo_tamanho_bytes / 1024).toFixed(0)} KB
                        </span>
                        <button
                          type="button"
                          onClick={() => handleBaixarAnexo(a.id)}
                          disabled={pending}
                          className="text-california-red hover:opacity-70 disabled:opacity-50"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Ações financeiras (só enquanto está em avaliação) */}
            {podeEditar && (
              <div className="space-y-3 rounded-lg border border-border p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Ações do financeiro
                </h3>
                <div>
                  <label className="text-xs font-medium">
                    Prazo pagamento financeiro
                  </label>
                  <p className="text-[11px] text-muted-foreground mb-1">
                    Data em que o financeiro vai efetuar o pagamento (interno; não vai pro PDF).
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <DatePicker
                        name="prazo_financeiro"
                        defaultValue={prazoLocal ?? undefined}
                        onDateChange={(date) => setPrazoLocal(isoDateFromDate(date))}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSalvarPrazo}
                      disabled={pending || !prazoMudou}
                      className="rounded-lg bg-california-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
                    >
                      Salvar prazo
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Avaliação: aprovar pagando, ou devolver pro GP corrigir.
              Cancelar não mora aqui — é exclusivo da aba de PPs do job. */}
          {podeEditar && (
            <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
              <button
                type="button"
                onClick={() => setAskRejeitar(true)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-white px-3 py-2 text-xs font-semibold text-california-red transition-colors hover:bg-california-red hover:text-white disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" />
                Rejeitar
              </button>

              <button
                type="button"
                disabled={pp.status !== "em_avaliacao" || pending}
                onClick={() => {
                  startTransition(async () => {
                    const res = await aprovarPP(pp.id);
                    if (!res.ok) {
                      setErro(res.message);
                    } else {
                      onOpenChange(false);
                      setToast(`${pp.codigo} aprovada — vai para "A pagar".`);
                      router.refresh();
                    }
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Aprovar
              </button>
            </div>
          )}

          {pp.status === "pago" && (
            <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
              <button
                type="button"
                onClick={() => setCancelarBaixaOpen(true)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-white px-3 py-2 text-xs font-semibold text-california-red hover:bg-california-red hover:text-white disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" />
                Cancelar baixa
              </button>
            </div>
          )}
        </DrawerContent>
      </Dialog>

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
              A PP volta pro gerente do job, que vê o motivo, corrige e reenvia
              para avaliação. O item continua reservado — não vira uma PP nova.
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

      {pp && (
        <CancelarBaixaModal
          pp={pp}
          open={cancelarBaixaOpen}
          onOpenChange={setCancelarBaixaOpen}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated animate-in fade-in slide-in-from-bottom-2"
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
