"use client";

/**
 * O que um título JÁ PAGO abre quando você clica nele, na aba "Títulos a
 * Pagar" (Tela 3.2).
 *
 * É o espelho em leitura do `BaixaTituloDialog`: mostra o pagamento que
 * foi registrado — data, conta, centro de custo — e traz, dentro do
 * mesmo formulário, o botão de **estornar**.
 *
 * ⚠️ Reverte a decisão 016, que tinha tirado o estorno da tela seguindo o
 * protótipo. O Tiago pediu de volta em 18/08/2026: "adicione a opção de
 * fazer um estorno ao clicar em um título sobre o qual já foi dado baixa,
 * com um botão no formulário aberto com o clique". Reverter uma baixa
 * errada não pode exigir intervenção fora do sistema.
 *
 * O estorno abre em dois tempos de propósito: o botão sozinho, e só
 * depois o campo de motivo com o confirmar. É a ação mais destrutiva da
 * aba — desfaz dinheiro que já foi para a conciliação —, então não fica a
 * um clique de distância de quem só queria conferir a baixa.
 */

import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  RotateCcw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";

export interface BaixaRegistradaAlvo {
  titulo: string;
  origem: string;
  parcela: string;
  valor: number;
  /** Data em que o pagamento saiu — o `pago_em` do título. */
  pagoEm: string | null;
  contaNome: string | null;
  centroNome: string | null;
  /** Data de pagamento vigente e vencimento original, para a conferência
   *  ficar completa sem obrigar a fechar o modal. */
  dataPagamento: string | null;
  vencOriginal: string | null;
}

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const MOTIVO_MINIMO = 10;

export function BaixaRegistradaDialog({
  open,
  onOpenChange,
  alvo,
  pending,
  erro,
  onEstornar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alvo: BaixaRegistradaAlvo | null;
  pending: boolean;
  erro: string | null;
  onEstornar: (motivo: string) => void;
}) {
  const [confirmando, setConfirmando] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);

  // Cada abertura começa do zero: o modal é reusado entre linhas, e um
  // motivo digitado para um título não pode sobrar para o seguinte.
  React.useEffect(() => {
    if (!open) return;
    setConfirmando(false);
    setMotivo("");
    setErroLocal(null);
  }, [open, alvo]);

  if (!alvo) return null;
  const mensagemErro = erro ?? erroLocal;
  const motivoOk = motivo.trim().length >= MOTIVO_MINIMO;

  function handleEstornar() {
    setErroLocal(null);
    if (!motivoOk) {
      setErroLocal(
        `Explique o motivo do estorno em pelo menos ${MOTIVO_MINIMO} caracteres.`,
      );
      return;
    }
    onEstornar(motivo.trim());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="h-5 w-5 text-emerald-600" />
            Baixa registrada
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/40 p-4 text-sm">
          <span className="text-muted-foreground">Título</span>
          <span className="font-semibold">{alvo.titulo}</span>
          <span className="text-muted-foreground">Origem</span>
          <span>{alvo.origem}</span>
          <span className="text-muted-foreground">Parcela</span>
          <span className="font-mono text-xs">{alvo.parcela}</span>
          <span className="text-muted-foreground">Venc. original</span>
          <span className="font-mono text-xs">
            {formatarData(alvo.vencOriginal)}
          </span>
          <span className="text-muted-foreground">Data de pagamento</span>
          <span className="font-mono text-xs">
            {formatarData(alvo.dataPagamento)}
          </span>
          <span className="text-muted-foreground">Valor</span>
          <span className="font-mono font-bold">
            {formatCurrency(alvo.valor, "BRL")}
          </span>
        </div>

        {/* O que a baixa efetivamente registrou. Verde porque é o estado
            corrente do título, e é dele que o estorno parte. */}
        <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">
            Enviado para a conciliação
          </p>
          <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">Pago em</span>
            <span className="font-mono text-xs">
              {formatarData(alvo.pagoEm)}
            </span>
            <span className="text-muted-foreground">Conta</span>
            <span>{alvo.contaNome ?? "—"}</span>
            <span className="text-muted-foreground">Centro de custo</span>
            <span>{alvo.centroNome ?? "—"}</span>
          </div>
        </div>

        {mensagemErro && (
          <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{mensagemErro}</span>
          </div>
        )}

        {confirmando && (
          <div className="space-y-2 rounded-xl border border-california-red/30 bg-california-red/5 p-4">
            <p className="flex items-start gap-2 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-california-red" />
              <span>
                O título volta para{" "}
                <span className="font-semibold">A pagar</span> e um lançamento
                reverso é gerado na mesma conta bancária, mantendo o histórico
                contábil. O motivo fica no log de auditoria.
              </span>
            </p>
            <div className="space-y-1">
              <label className="text-xs font-semibold">
                Motivo do estorno{" "}
                <span className="text-california-red">*</span>
              </label>
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={500}
                rows={3}
                autoFocus
                className="w-full rounded-lg border border-border p-2 text-sm"
                placeholder="Ex.: valor lançado divergia do valor real pago; conta bancária errada."
              />
              <p className="text-[11px] text-muted-foreground">
                {motivo.trim().length}/500 caracteres · mínimo{" "}
                {MOTIVO_MINIMO}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          {confirmando ? (
            <button
              type="button"
              onClick={() => {
                setConfirmando(false);
                setMotivo("");
                setErroLocal(null);
              }}
              disabled={pending}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Voltar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/40 px-3 py-2 text-sm font-semibold text-california-red transition-colors hover:bg-california-red/5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Estornar baixa
            </button>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Fechar
            </button>
            {confirmando && (
              <button
                type="button"
                onClick={handleEstornar}
                disabled={pending || !motivoOk}
                className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {pending ? "Estornando..." : "Confirmar estorno"}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
