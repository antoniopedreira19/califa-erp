"use client";

/**
 * A PP já enviada, no MESMO formulário em que ela foi preenchida — só que
 * travado (decisão do Tiago, 09/09/2026).
 *
 * A primeira versão desta tela (08/09) era uma ficha própria, com outra
 * ordem e outros rótulos. Ela obrigava quem já conhece o formulário de PP
 * a reaprender onde cada coisa mora. Agora é o formulário de `Gerar PP`
 * espelhado campo a campo, na mesma ordem e com os mesmos rótulos, em
 * caixas de leitura: quem gerou a PP reconhece a tela na hora.
 *
 * Duas diferenças de propósito:
 *
 *   * **a pergunta "Esta é a última PP deste item?" não existe aqui** —
 *     ela é sobre o item e já foi respondida na emissão (decisão 052);
 *   * **no lugar dela entra a linha do tempo** da PP: gerada → enviada →
 *     avaliação → aprovação → pagamento, com o passo de hoje aceso e os
 *     que ainda vêm apagados. É o que a produção pergunta depois do envio.
 *
 * Nada aqui grava, exceto o "Cancelar PP" do rodapé, que é a mesma action
 * e a mesma confirmação do painel "Destrinchar realizado".
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  X,
  FileText,
  Eye,
  AlertCircle,
  Ban,
  Lock,
  Check,
  Clock,
  History,
} from "lucide-react";
import {
  Dialog,
  DrawerContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn, formatCurrency } from "@/lib/utils";
import { podeCancelarPP, type PedidoCompraNaLista } from "@/lib/types";
import { PPStatusChip } from "./pp-status-chip";
import {
  signedUrlPdf,
  signedUrlPdfParcela,
  signedUrlAnexo,
  cancelarPedidoCompra,
} from "../realizado/actions-pp";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pp: PedidoCompraNaLista | null;
  /** Fornecedor, ou o nome do responsável na verba de produção. Quem
   *  resolve o nome é quem já tem a lista de fornecedores carregada. */
  contraparteNome: string;
  empresaNome: string;
  /** O cartão do topo, igual ao do formulário: item, planejado e o que o
   *  item já tem em PPs que chegaram ao financeiro. */
  itemDescricao: string;
  valorPlanejado: number;
  emPPsEmitidas: number;
  /** Cancelar no rodapé. `false` esconde o botão — quem só lê o job (o
   *  financeiro, o job encerrado) não cancela nada daqui. */
  podeCancelar: boolean;
  /** Toast de quem abriu a ficha. */
  onMensagem?: (mensagem: string) => void;
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

/** O unitário do formulário mostra centavos sempre. */
function formatUnitario(n: number): string {
  return formatCurrency(Number(n ?? 0), "BRL");
}

function formatarTamanho(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

/** Um passo da linha do tempo. */
interface Passo {
  chave: string;
  titulo: string;
  detalhe?: string | null;
  quando?: string | null;
  estado: "feito" | "agora" | "futuro";
}

/**
 * A linha do tempo da PP, montada do que o registro tem.
 *
 * Só entra passo que aconteceu de verdade (tem data) ou que ainda vai
 * acontecer no caminho normal. Rejeição, aprovação, pagamento e
 * cancelamento aparecem quando existem — e a rejeição carrega o motivo,
 * que é o que faz o GP corrigir a PP.
 */
function passosDaPP(pp: PedidoCompraNaLista): Passo[] {
  const passos: Passo[] = [];

  passos.push({
    chave: "gerada",
    titulo: "Gerada",
    detalhe: pp.emitida_por_nome,
    quando: formatDataHora(pp.created_at),
    estado: "feito",
  });

  if (pp.enviada_financeiro_em) {
    passos.push({
      chave: "enviada",
      titulo: "Enviada ao financeiro",
      detalhe: pp.enviada_financeiro_por_nome,
      quando: formatDataHora(pp.enviada_financeiro_em),
      estado: "feito",
    });
  }

  if (pp.rejeitada_em) {
    passos.push({
      chave: "rejeitada",
      titulo: "Rejeitada pelo financeiro",
      detalhe: pp.motivo_rejeicao,
      quando: formatDataHora(pp.rejeitada_em),
      estado: pp.status === "rejeitada" ? "agora" : "feito",
    });
  }

  if (pp.status === "em_avaliacao") {
    passos.push({
      chave: "avaliacao",
      titulo: "Em avaliação no financeiro",
      detalhe: "aguardando a data de pagamento e a aprovação",
      quando: "agora",
      estado: "agora",
    });
  }

  if (pp.aprovada_em) {
    passos.push({
      chave: "aprovada",
      titulo: "Aprovada pelo financeiro",
      detalhe: pp.prazo_pagamento_financeiro
        ? `pagamento programado para ${formatData(pp.prazo_pagamento_financeiro)}`
        : "virou título a pagar",
      quando: formatDataHora(pp.aprovada_em),
      estado: pp.status === "aprovada" ? "agora" : "feito",
    });
  } else if (pp.status === "em_avaliacao") {
    passos.push({
      chave: "aprovada",
      titulo: "Aprovação",
      quando: null,
      estado: "futuro",
    });
  }

  if (pp.pago_em) {
    passos.push({
      chave: "pago",
      titulo: "Paga",
      quando: formatData(pp.pago_em),
      estado: "agora",
    });
  } else if (pp.status === "em_avaliacao" || pp.status === "aprovada") {
    passos.push({
      chave: "pago",
      titulo: "Pagamento",
      quando: null,
      estado: "futuro",
    });
  }

  if (pp.cancelada_em) {
    passos.push({
      chave: "cancelada",
      titulo: "Cancelada",
      detalhe: "o PDF e os anexos ficam guardados no histórico",
      quando: formatDataHora(pp.cancelada_em),
      estado: "agora",
    });
  }

  return passos;
}

export function VerPPDrawer({
  open,
  onOpenChange,
  pp,
  contraparteNome,
  empresaNome,
  itemDescricao,
  valorPlanejado,
  emPPsEmitidas,
  podeCancelar,
  onMensagem,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [confirmandoCancelar, setConfirmandoCancelar] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setErro(null);
      setConfirmandoCancelar(false);
    }
  }, [open]);

  /** Todo documento passa por uma URL assinada de validade curta — o
   *  bucket é privado. */
  function abrir(
    promessa: Promise<{ ok: true; url: string } | { ok: false; message: string }>,
  ) {
    startTransition(async () => {
      const res = await promessa;
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  function cancelar() {
    if (!pp) return;
    const codigo = pp.codigo;
    startTransition(async () => {
      const res = await cancelarPedidoCompra(pp.id);
      setConfirmandoCancelar(false);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onMensagem?.(`${codigo} cancelada.`);
      router.refresh();
      onOpenChange(false);
    });
  }

  if (!open || !pp) return null;

  const parcelas = pp.parcelas ?? [];
  const anexos = pp.anexos ?? [];
  const passos = passosDaPP(pp);
  const cancelavel = podeCancelarPP(pp.status);
  const motivoSemCancelar =
    pp.status === "aprovada"
      ? "PP já aprovada pelo financeiro — é título a pagar. Peça a desaprovação antes de cancelar."
      : pp.status === "pago"
        ? "PP já paga — cancelar exigiria estorno pelo financeiro."
        : "Esta PP não pode mais ser cancelada.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle className="flex flex-wrap items-center gap-2.5">
            Pedido de Produção · {pp.codigo}
            <PPStatusChip status={pp.status} />
          </DialogTitle>
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Lock className="h-3 w-3 flex-none" />
            Somente leitura — a PP já foi enviada ao financeiro e não é mais
            editável.
          </p>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {erro && (
            <div className="flex items-start justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
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
                  A correção e o reenvio ficam na aba “Pedidos de Produção” do
                  job.
                </p>
              </div>
            </div>
          )}

          {pp.status === "cancelada" && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
              <Ban className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                <strong className="text-foreground">{pp.codigo} cancelada</strong>{" "}
                em {formatDataHora(pp.cancelada_em)}. O PDF e os anexos ficam
                guardados no histórico.
              </p>
            </div>
          )}

          {/* O cartão do item, como no formulário: o planejado é a
              referência da PP, e "Em PPs emitidas" é o que o item já tem
              no financeiro (aqui já contando esta PP, que foi enviada). */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Item</p>
            <p className="font-medium">{itemDescricao || pp.item_nome || "—"}</p>
            {pp.grupo_nome && (
              <p className="text-[11px] text-muted-foreground">
                bloco {pp.grupo_nome}
              </p>
            )}
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Planejado do item</p>
                <p className="font-mono font-semibold">
                  {formatCurrency(valorPlanejado, "BRL")}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Em PPs emitidas</p>
                <p className="font-mono font-semibold">
                  {formatCurrency(emPPsEmitidas, "BRL")}
                </p>
              </div>
            </div>
          </div>

          {/* Fornecedor & Empresa — a mesma ordem do formulário. */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Fornecedor &amp; Empresa
            </h3>

            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  "relative inline-flex h-5 w-9 flex-none items-center rounded-full border-2 border-transparent",
                  pp.verba_producao
                    ? "bg-california-red/60"
                    : "bg-muted-foreground/25",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 rounded-full bg-white shadow",
                    pp.verba_producao ? "translate-x-4" : "translate-x-0",
                  )}
                />
              </span>
              <span className="text-sm font-medium text-muted-foreground">
                Verba de Produção
              </span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {pp.verba_producao ? "Pago ao responsável interno" : "Não"}
              </span>
            </div>

            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Valor desta PP
                </h4>
                <span className="text-[11px] text-muted-foreground">
                  mesmas colunas do item na planilha
                </span>
              </div>

              <div className="grid grid-cols-[1.5fr_0.75fr_0.75fr] gap-2.5">
                <CampoLido rotulo="R$ Unit." mono direita>
                  {formatUnitario(pp.valor_unitario)}
                </CampoLido>
                <CampoLido rotulo="QT" mono direita>
                  {formatFator(pp.quantidade)}
                </CampoLido>
                <CampoLido rotulo="D/M" mono direita>
                  {formatFator(pp.dias_meses)}
                </CampoLido>
              </div>

              <div className="flex items-end justify-between gap-4 border-t border-border pt-3">
                <div>
                  <p className="text-[11px] text-muted-foreground">
                    Valor desta PP
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {formatUnitario(pp.valor_unitario)} ×{" "}
                    {formatFator(pp.quantidade)} × {formatFator(pp.dias_meses)}
                  </p>
                </div>
                <span className="font-mono text-[22px] font-bold leading-none">
                  {formatCurrency(Number(pp.valor ?? 0), "BRL")}
                </span>
              </div>
            </div>

            <div>
              <CampoLido
                rotulo={pp.verba_producao ? "Responsável" : "Fornecedor"}
              >
                {contraparteNome || "—"}
                {pp.cadastro_do_fornecedor_mudou && (
                  <span
                    className="ml-1 font-bold text-amber-600"
                    aria-hidden="true"
                  >
                    *
                  </span>
                )}
              </CampoLido>
              {/* O asterisco da decisão 067, explicado por extenso. Esta é
                  a ficha que alguém abre justamente para conferir uma PP
                  que já saiu do job, e a pergunta que o asterisco levanta
                  ("então ela vai pagar errado?") precisa de resposta —
                  não: ela paga pelo documento dela. */}
              {pp.cadastro_do_fornecedor_mudou && (
                <p className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11.5px] leading-relaxed text-amber-800">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-700" />
                  <span>
                    Os dados de pagamento deste fornecedor mudaram depois que
                    esta PP foi montada. Ela continua valendo pelo que está no
                    documento dela — o cadastro novo vale para as próximas PPs.
                  </span>
                </p>
              )}
            </div>

            <CampoLido rotulo="Empresa emissora">{empresaNome || "—"}</CampoLido>

            <div className="grid grid-cols-2 gap-3">
              <CampoLido rotulo="Prazo de pagamento" mono>
                {formatData(pp.prazo_pagamento)}
              </CampoLido>
              <CampoLido rotulo="Parcelas" mono>
                {parcelas.length || 1}
              </CampoLido>
            </div>

            {parcelas.length > 1 && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[11px] text-muted-foreground">
                  Vencimentos combinados com o fornecedor na emissão. A data de
                  pagamento é a que o financeiro programa na aprovação.
                </p>
                {parcelas.map((parcela, i) => (
                  <div
                    key={parcela.id}
                    className="grid grid-cols-[28px_1fr_1fr_28px] items-center gap-2"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {i + 1}/{parcelas.length}
                    </span>
                    <div className="flex h-9 items-center rounded-lg border border-border bg-muted/40 px-3 font-mono text-[12.5px]">
                      {formatData(parcela.data_vencimento)}
                    </div>
                    <div className="flex h-9 items-center justify-end rounded-lg border border-border bg-muted/40 px-3 font-mono text-[12.5px]">
                      {formatCurrency(Number(parcela.valor ?? 0), "BRL")}
                    </div>
                    <button
                      type="button"
                      title={`Ver PDF da parcela ${i + 1}`}
                      aria-label={`Ver PDF da parcela ${i + 1}`}
                      onClick={() => abrir(signedUrlPdfParcela(parcela.id))}
                      disabled={pending}
                      className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      <Eye className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {parcelas.some((p) => p.data_pagamento) && (
                  <div className="flex flex-col gap-1 border-t border-border pt-2">
                    {parcelas.map((parcela, i) =>
                      parcela.data_pagamento ? (
                        <span
                          key={parcela.id}
                          className="text-[11px] text-muted-foreground"
                        >
                          Parcela {i + 1}: pagamento programado para{" "}
                          <span className="font-mono">
                            {formatData(parcela.data_pagamento)}
                          </span>
                        </span>
                      ) : null,
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Serviço */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Serviço
            </h3>
            <CampoLido rotulo="Descrição do serviço" alturaLivre>
              {pp.servico}
            </CampoLido>
            <CampoLido rotulo="Especificações" alturaLivre>
              {pp.especificacoes?.trim() ? (
                <span className="whitespace-pre-wrap">{pp.especificacoes}</span>
              ) : (
                <span className="text-muted-foreground">
                  Sem especificações nesta PP.
                </span>
              )}
            </CampoLido>
          </div>

          {/* Anexos */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Anexos {anexos.length > 0 ? `· ${anexos.length}` : ""}
            </h3>
            {anexos.length === 0 ? (
              <p className="rounded border border-dashed border-border p-3 text-[12.5px] text-muted-foreground">
                {pp.verba_producao
                  ? "Verba de produção sai sem anexo — as notas entram na prestação de contas."
                  : "Sem anexos nesta PP."}
              </p>
            ) : (
              anexos.map((anexo) => (
                <div
                  key={anexo.id}
                  className="flex items-center gap-2 rounded border border-border bg-white px-3 py-2 text-xs"
                >
                  <FileText className="h-3.5 w-3.5 flex-none text-muted-foreground" />
                  <span className="min-w-0 flex-1 leading-snug">
                    {anexo.arquivo_nome_original}
                  </span>
                  <span className="flex-none text-muted-foreground">
                    {formatarTamanho(anexo.arquivo_tamanho_bytes)}
                  </span>
                  <button
                    type="button"
                    title="Abrir anexo"
                    aria-label={`Abrir ${anexo.arquivo_nome_original}`}
                    onClick={() => abrir(signedUrlAnexo(anexo.id))}
                    disabled={pending}
                    className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <Eye className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* No lugar da pergunta "Esta é a última PP deste item?", que só
            faz sentido na emissão: o que aconteceu com a PP até aqui. */}
        <div className="flex flex-col gap-3 border-t border-border px-6 pb-5 pt-4">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <History className="h-3.5 w-3.5 text-california-red" />
            Linha do tempo
          </span>
          <ol className="flex flex-col">
            {passos.map((passo, i) => (
              <li
                key={passo.chave}
                className="relative grid grid-cols-[17px_1fr_auto] items-start gap-x-3"
              >
                {i < passos.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-2 top-4 w-px bg-border"
                  />
                )}
                <span
                  className={cn(
                    "relative z-10 mt-0.5 inline-flex h-[17px] w-[17px] items-center justify-center rounded-full border-2 bg-card",
                    passo.estado === "feito" &&
                      "border-foreground bg-foreground text-white",
                    passo.estado === "agora" &&
                      "border-amber-600 bg-amber-50 text-amber-700",
                    passo.estado === "futuro" && "border-border",
                  )}
                >
                  {passo.estado === "feito" && <Check className="h-2.5 w-2.5" />}
                  {passo.estado === "agora" && <Clock className="h-2.5 w-2.5" />}
                </span>
                <span className={cn("flex flex-col pb-3.5")}>
                  <span
                    className={cn(
                      "text-[12.5px] font-semibold",
                      passo.estado === "futuro" &&
                        "font-medium text-muted-foreground",
                    )}
                  >
                    {passo.titulo}
                  </span>
                  {passo.detalhe && (
                    <span className="text-[11.5px] leading-snug text-muted-foreground">
                      {passo.detalhe}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "font-mono text-[11px] text-muted-foreground",
                    passo.estado === "agora" && "font-semibold text-amber-700",
                  )}
                >
                  {passo.quando ?? "—"}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={() => abrir(signedUrlPdf(pp.id))}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            Ver PDF da PP
          </button>
          {/* A mesma regra do painel: em avaliação e rejeitada ainda voltam
              atrás; aprovada é título a pagar e paga precisaria de estorno.
              Nesses dois o botão fica apagado com o motivo. */}
          {podeCancelar && (
            <button
              type="button"
              onClick={() => setConfirmandoCancelar(true)}
              disabled={pending || !cancelavel}
              title={cancelavel ? "Cancelar PP" : motivoSemCancelar}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50",
                cancelavel
                  ? "border-california-red/35 bg-white text-california-red hover:bg-california-red/[0.06]"
                  : "cursor-not-allowed border-border bg-white text-muted-foreground",
              )}
            >
              <Ban className="h-3.5 w-3.5" />
              Cancelar PP
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="ml-auto rounded-lg bg-california-red px-4 py-2 text-[13px] font-semibold text-white hover:bg-california-red-hover"
          >
            Fechar
          </button>
        </div>

        <ConfirmDialog
          open={confirmandoCancelar}
          onOpenChange={setConfirmandoCancelar}
          title="Cancelar Pedido de Produção?"
          description={
            <>
              <strong className="text-foreground">{pp.codigo}</strong> será
              cancelada. O PDF e os anexos ficam guardados no histórico. Ela já
              está no financeiro: cancelar a tira da fila de avaliação e ela
              deixa de contar no realizado do item.
            </>
          }
          confirmLabel="Cancelar PP"
          cancelLabel="Voltar"
          variant="destructive"
          pending={pending}
          onConfirm={cancelar}
        />
      </DrawerContent>
    </Dialog>
  );
}

/**
 * Um campo do formulário, travado.
 *
 * Mesma altura, borda e raio do `Input`, com o fundo do desabilitado: a
 * tela precisa ser reconhecível como O formulário da PP, não como uma
 * ficha nova. `alturaLivre` é para os campos que no formulário são
 * textarea ou texto longo.
 */
function CampoLido({
  rotulo,
  children,
  mono,
  direita,
  alturaLivre,
}: {
  rotulo: string;
  children: React.ReactNode;
  mono?: boolean;
  direita?: boolean;
  alturaLivre?: boolean;
}) {
  return (
    <div>
      <span className="text-xs font-medium">{rotulo}</span>
      <div
        className={cn(
          "mt-1 w-full rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-sm leading-snug text-foreground",
          !alturaLivre && "flex min-h-11 items-center",
          mono && "font-mono font-semibold",
          direita && "justify-end text-right",
        )}
      >
        {children}
      </div>
    </div>
  );
}
