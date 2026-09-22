"use client";

/**
 * Recusar um pedido de save da faixa Saves (decisão 099, 22/09/2026).
 *
 * No padrão do `ReprovarDialog`: justificativa obrigatória, mínimo de 10
 * caracteres, e a caixa de quem precisa corrigir. Abre só depois do
 * clique em "Recusar save"/"Recusar consumo" no pop-up de aprovação — e
 * "Voltar" devolve para ele.
 *
 * A recusa desfaz a linha (a RPC volta o save ou o consumo ao que era
 * logo antes do pedido) e a justificativa aparece no pop-up de save da
 * linha e num card da Comunicação do job, para a produção corrigir.
 * Textos da especificação (seção 3, "Recusa").
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CornerUpLeft, MessageSquare, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { recusarPedidoDeSave } from "./save-actions";
import type { SaveFilaLinha } from "./fila-list";

const MAX_MOTIVO = 500;
const MIN_MOTIVO = 10;

export function RecusarSaveDialog({
  save,
  onVoltar,
  onRecusado,
}: {
  save: SaveFilaLinha;
  /** Fecha a recusa e devolve para o pop-up de aprovação. */
  onVoltar: () => void;
  /** A recusa gravou: fecha tudo. */
  onRecusado: () => void;
}) {
  const router = useRouter();
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [tentouEnviar, setTentouEnviar] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const gera = save.tipo === "gera";

  const curto = motivo.trim().length < MIN_MOTIVO;
  const mostrarErroCampo = tentouEnviar && curto;

  function handleEnviar() {
    setTentouEnviar(true);
    if (curto) return;
    setErro(null);
    startTransition(async () => {
      const res = await recusarPedidoDeSave(save.id, motivo.trim());
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onRecusado();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !pending && onVoltar()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-california-red/10 text-california-red">
            <CornerUpLeft className="h-5 w-5" />
          </div>
          <DialogTitle className="pt-4 text-[19px]">
            {`${gera ? "Recusar o save" : "Recusar o consumo"} de “${save.itemDescricao}”?`}
          </DialogTitle>
          <DialogDescription className="text-[13.5px] leading-relaxed">
            Escreva por que o save não pode ser aprovado. A justificativa fica
            registrada no pop-up de save da linha, para a produção corrigir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2.5">
            <label
              htmlFor="motivo-recusa-save"
              className="text-[12.5px] font-semibold"
            >
              Justificativa <span className="text-california-red">*</span>
            </label>
            <span className="font-mono text-[11px] text-muted-foreground">
              {motivo.length}/{MAX_MOTIVO}
            </span>
          </div>
          <textarea
            id="motivo-recusa-save"
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value.slice(0, MAX_MOTIVO));
              setTentouEnviar(false);
            }}
            rows={4}
            autoFocus
            className={cn(
              "min-h-[104px] w-full resize-y rounded-lg border bg-white px-3.5 py-3 text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-california-red/20",
              mostrarErroCampo ? "border-california-red" : "border-border",
            )}
            placeholder={
              gera
                ? "Ex.: esta linha acontece neste job — o cliente confirmou o serviço. Retire a marca de save."
                : "Ex.: o saldo de origem está reservado para o próximo evento. Use outra origem."
            }
          />
          {mostrarErroCampo && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-california-red">
              <AlertCircle className="h-3 w-3" />
              Escreva a justificativa com pelo menos {MIN_MOTIVO} caracteres.
            </span>
          )}
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 px-3.5 py-3">
          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Quem precisa corrigir:{" "}
            <strong className="text-foreground">
              {save.responsavelNome ?? "GP do job"}
            </strong>{" "}
            (GP)
            {save.produtorNome && (
              <>
                {" "}
                e{" "}
                <strong className="text-foreground">{save.produtorNome}</strong>{" "}
                (produtor)
              </>
            )}
            . O save sai desta fila e fica marcado como recusado no pop-up de
            save da linha.
          </p>
        </div>

        {erro && (
          <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onVoltar}
            disabled={pending}
            className="rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={handleEnviar}
            disabled={pending || curto}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Send className="h-4 w-4" />
            {pending ? "Enviando..." : "Enviar justificativa"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
