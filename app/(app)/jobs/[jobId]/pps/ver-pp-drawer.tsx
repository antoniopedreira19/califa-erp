"use client";

/**
 * A ficha da PP em LEITURA — o formulário como ele foi preenchido.
 *
 * A decisão 039 já dizia que "enviar, editar, ver e cancelar são ações
 * por PP" no painel do item, mas "ver" era só o PDF. Depois do envio ao
 * financeiro a PP fica sem formulário: ela não pode mais ser editada
 * (`editarPedidoCompraGerada` só aceita a gerada), e o PDF não mostra a
 * empresa emissora, o parcelamento com as datas do financeiro, os
 * anexos, quem enviou nem o motivo de uma rejeição. Era exatamente isso
 * que a produção precisava reler antes de decidir se cancela.
 *
 * Nada aqui grava. É o mesmo conteúdo do formulário de edição, na mesma
 * ordem — Fornecedor & Empresa, Serviço, Parcelas, Anexos —, com o
 * registro do ciclo (gerada, enviada, rejeitada, cancelada) no topo.
 */

import * as React from "react";
import {
  X,
  FileText,
  Eye,
  AlertCircle,
  Ban,
  CalendarClock,
} from "lucide-react";
import {
  Dialog,
  DrawerContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatCurrency } from "@/lib/utils";
import type { PedidoCompraNaLista } from "@/lib/types";
import { PPStatusChip } from "./pp-status-chip";
import {
  signedUrlPdf,
  signedUrlPdfParcela,
  signedUrlAnexo,
} from "../realizado/actions-pp";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pp: PedidoCompraNaLista | null;
  /** Fornecedor, ou "Verba de Produção — Fulano". Quem resolve o nome é
   *  quem já tem a lista de fornecedores carregada. */
  contraparteNome: string;
  empresaNome: string;
}

function formatData(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatDataHora(iso: string | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Quantidade e D/M são fatores, não dinheiro: sem R$ e sem zeros à toa. */
function formatFator(n: number): string {
  return Number(n ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formatarTamanho(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

export function VerPPDrawer({
  open,
  onOpenChange,
  pp,
  contraparteNome,
  empresaNome,
}: Props) {
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) setErro(null);
  }, [open]);

  /** Toda abertura de documento passa por uma URL assinada com validade
   *  curta — o bucket é privado. */
  function abrir(promessa: Promise<{ ok: true; url: string } | { ok: false; message: string }>) {
    startTransition(async () => {
      const res = await promessa;
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  if (!open || !pp) return null;

  const parcelas = pp.parcelas ?? [];
  const anexos = pp.anexos ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-xl">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle className="flex flex-wrap items-center gap-2.5">
            Pedido de Produção · {pp.codigo}
            <PPStatusChip status={pp.status} />
          </DialogTitle>
          <p className="text-[12px] text-muted-foreground">
            Somente leitura — a PP já foi enviada ao financeiro.
          </p>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {erro && (
            <div className="flex items-start justify-between gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
              <span>{erro}</span>
              <button
                type="button"
                onClick={() => setErro(null)}
                aria-label="Fechar aviso"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {pp.motivo_rejeicao && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
              <div className="flex flex-col gap-1">
                <p className="text-[12.5px] leading-relaxed text-red-700">
                  <strong>{pp.codigo} rejeitada pelo financeiro</strong> ·{" "}
                  {pp.motivo_rejeicao}
                </p>
                <p className="text-[11.5px] leading-snug text-red-700/80">
                  A correção e o reenvio ficam na aba “Pedidos de Produção”
                  do job.
                </p>
              </div>
            </div>
          )}

          {pp.status === "cancelada" && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
              <Ban className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                <strong className="text-foreground">
                  {pp.codigo} cancelada
                </strong>{" "}
                em {formatDataHora(pp.cancelada_em)}. O PDF e os anexos ficam
                guardados no histórico.
              </p>
            </div>
          )}

          {/* O item que a PP paga, e o valor dela. Mesma abertura do
              formulário de edição. */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Item</p>
            <p className="font-medium">
              {pp.servico}
              {pp.grupo_nome ? ` · ${pp.grupo_nome}` : ""}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">Valor desta PP</p>
            <p className="font-mono font-semibold">
              {formatCurrency(Number(pp.valor ?? 0), "BRL")}
            </p>
          </div>

          <Secao titulo="Registro">
            <Campo rotulo="Gerada por">
              {pp.emitida_por_nome ?? "—"}
              <span className="text-muted-foreground">
                {" "}
                · {formatDataHora(pp.created_at)}
              </span>
            </Campo>
            <Campo rotulo="Enviada ao financeiro por">
              {pp.enviada_financeiro_por_nome ?? "—"}
              <span className="text-muted-foreground">
                {" "}
                · {formatDataHora(pp.enviada_financeiro_em)}
              </span>
            </Campo>
          </Secao>

          <Secao titulo="Fornecedor & Empresa">
            <Campo rotulo={pp.verba_producao ? "Responsável pela verba" : "Fornecedor"}>
              {contraparteNome || "—"}
            </Campo>
            <Campo rotulo="Empresa emissora">{empresaNome || "—"}</Campo>
            <Campo rotulo="Prazo de pagamento">
              {formatData(pp.prazo_pagamento)}
              {pp.prazo_pagamento_financeiro &&
                pp.prazo_pagamento_financeiro !== pp.prazo_pagamento && (
                  <span className="text-muted-foreground">
                    {" "}
                    · data de pagamento do financeiro:{" "}
                    {formatData(pp.prazo_pagamento_financeiro)}
                  </span>
                )}
            </Campo>
          </Secao>

          <Secao titulo="Serviço">
            <Campo rotulo="Descrição do serviço">{pp.servico}</Campo>

            {/* O trio que forma o valor, na mesma ordem das colunas da
                planilha: R$ Unit. × QT × D/M. */}
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <div className="grid grid-cols-[1.5fr_0.75fr_0.75fr] gap-2.5">
                <Numero
                  rotulo="R$ Unit."
                  valor={formatCurrency(Number(pp.valor_unitario ?? 0), "BRL")}
                />
                <Numero rotulo="QT" valor={formatFator(pp.quantidade)} />
                <Numero rotulo="D/M" valor={formatFator(pp.dias_meses)} />
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="text-[11px] text-muted-foreground">
                  Valor desta PP
                </span>
                <span className="font-mono text-sm font-semibold">
                  {formatCurrency(Number(pp.valor ?? 0), "BRL")}
                </span>
              </div>
            </div>

            <Campo rotulo="Especificações">
              {pp.especificacoes ? (
                <span className="whitespace-pre-wrap">{pp.especificacoes}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Campo>
          </Secao>

          {parcelas.length > 0 && (
            <Secao titulo={`Parcelas · ${parcelas.length}`}>
              <div className="space-y-1.5">
                {parcelas.map((parcela) => (
                  <div
                    key={parcela.id}
                    className="flex items-center gap-2.5 rounded-lg border border-border bg-white px-3 py-2"
                  >
                    <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                      {parcela.numero}/{parcelas.length}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-mono text-[12.5px]">
                        {formatData(parcela.data_vencimento)}
                      </span>
                      {parcela.data_pagamento && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <CalendarClock className="h-3 w-3" />
                          pagamento em {formatData(parcela.data_pagamento)}
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-[12.5px] font-semibold">
                      {formatCurrency(Number(parcela.valor ?? 0), "BRL")}
                    </span>
                    {parcelas.length > 1 && (
                      <button
                        type="button"
                        title={`Ver PDF da parcela ${parcela.numero}`}
                        aria-label={`Ver PDF da parcela ${parcela.numero}`}
                        onClick={() => abrir(signedUrlPdfParcela(parcela.id))}
                        disabled={pending}
                        className="inline-flex h-[27px] w-[27px] flex-none items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        <Eye className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Secao>
          )}

          <Secao titulo={`Anexos · ${anexos.length}`}>
            {anexos.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[12px] text-muted-foreground">
                Sem anexos nesta PP.
              </p>
            ) : (
              <div className="space-y-1.5">
                {anexos.map((anexo) => (
                  <div
                    key={anexo.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {anexo.arquivo_nome_original}
                    </span>
                    <span className="text-muted-foreground">
                      {formatarTamanho(anexo.arquivo_tamanho_bytes)}
                    </span>
                    <button
                      type="button"
                      title="Abrir anexo"
                      aria-label="Abrir anexo"
                      onClick={() => abrir(signedUrlAnexo(anexo.id))}
                      disabled={pending}
                      className="inline-flex h-[27px] w-[27px] flex-none items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      <Eye className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Secao>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={() => abrir(signedUrlPdf(pp.id))}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            Ver PDF da PP
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg bg-california-red px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90"
          >
            Fechar
          </button>
        </div>
      </DrawerContent>
    </Dialog>
  );
}

function Secao({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </h3>
      {children}
    </div>
  );
}

function Campo({
  rotulo,
  children,
  className,
}: {
  rotulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">
        {rotulo}
      </span>
      <span className="text-[13px]">{children}</span>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">
        {rotulo}
      </span>
      <span className="rounded-md border border-border bg-white px-2 py-1.5 text-right font-mono text-[13px] font-semibold">
        {valor}
      </span>
    </div>
  );
}
