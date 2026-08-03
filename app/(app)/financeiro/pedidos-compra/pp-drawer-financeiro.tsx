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
  CreditCard,
  ExternalLink,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DrawerContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import { ppStatusLabel } from "@/lib/types";
import type { PPRow } from "./pedidos-compra-list";
import {
  salvarPrazoFinanceiro,
  cancelarPedidoCompraFinanceiro,
} from "./actions";
import {
  signedUrlPdf,
  signedUrlAnexo,
} from "@/app/(app)/jobs/[jobId]/realizado/actions-pp";

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
  const [askCancelar, setAskCancelar] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");

  // Sincroniza prazo local com o valor da PP ao abrir/trocar
  React.useEffect(() => {
    if (!pp) return;
    setPrazoLocal(pp.prazo_pagamento_financeiro);
    setErro(null);
    setMotivo("");
  }, [pp]);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!pp) return null;

  const podeEditar = pp.status === "emitida";
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

  function handleConfirmarCancelar() {
    if (!pp) return;
    startTransition(async () => {
      const res = await cancelarPedidoCompraFinanceiro(pp.id, motivo);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setAskCancelar(false);
      onOpenChange(false);
      setToast(`${pp.codigo} cancelada.`);
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
              <Badge
                className={cn(
                  "border",
                  pp.status === "emitida"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-slate-100 text-slate-500 border-slate-200",
                )}
              >
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

            {/* Ações financeiras (só se emitida) */}
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
                        key={pp.id}
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

          {/* Footer com Baixa (desabilitada) + Cancelar */}
          {podeEditar && (
            <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <button
                      type="button"
                      disabled
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground cursor-not-allowed opacity-60"
                    >
                      <CreditCard className="h-3.5 w-3.5" />
                      Dar Baixa
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Em breve — vira lançamento em contas a pagar (fase 3)
                </TooltipContent>
              </Tooltip>

              <button
                type="button"
                onClick={() => setAskCancelar(true)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-white px-3 py-2 text-xs font-semibold text-california-red hover:bg-california-red hover:text-white transition-colors disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" />
                Cancelar PP
              </button>
            </div>
          )}
        </DrawerContent>
      </Dialog>

      {/* Confirm cancelar */}
      <Dialog
        open={askCancelar}
        onOpenChange={(o) => {
          setAskCancelar(o);
          if (!o) setMotivo("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar {pp.codigo}?</DialogTitle>
            <DialogDescription>
              Esta ação marca a PP como cancelada e libera o item pra gerar uma nova.
              O PDF e anexos permanecem arquivados.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 px-6 pb-2">
            <label htmlFor="motivo-cancelar" className="text-xs font-medium">
              Motivo * (mín 10 caracteres)
            </label>
            <textarea
              id="motivo-cancelar"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={500}
              rows={3}
              className="w-full rounded border border-border p-2 text-sm"
              placeholder="Ex: valor divergente do combinado com o fornecedor..."
            />
            <p className="text-[11px] text-muted-foreground">
              {motivo.trim().length}/500 caracteres
            </p>
          </div>
          <div className="flex justify-end gap-2 px-6 pb-6">
            <button
              type="button"
              onClick={() => setAskCancelar(false)}
              disabled={pending}
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-accent disabled:opacity-50"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={handleConfirmarCancelar}
              disabled={pending || motivo.trim().length < 10}
              className="rounded-lg bg-california-red px-3 py-2 text-xs font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
            >
              Confirmar cancelamento
            </button>
          </div>
        </DialogContent>
      </Dialog>

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
