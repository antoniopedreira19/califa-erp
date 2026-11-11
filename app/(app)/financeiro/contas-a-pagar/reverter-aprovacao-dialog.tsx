"use client";

/**
 * "Reverter aprovação" (decisão 253): o mesmo pop-up para PP, desembolso e
 * folha. Duas saídas, escolhidas na hora: voltar para avaliação ou
 * rejeitar. Motivo obrigatório. Só antes da baixa (a regra mora no banco).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Ban, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { reverterAprovacao, type DestinoDaReversao, type OrigemDaReversao } from "./actions-reverter";

const TEXTO: Record<OrigemDaReversao, { avaliacao: string; rejeitar: string; titulo: string }> = {
  pp: {
    avaliacao: "A PP volta para “Em avaliação” na aba Pedidos de Produção, para aprovar de novo ou rejeitar.",
    rejeitar: "A PP volta para a produção como rejeitada, que cancela ou refaz. Se o reenvio piorar, passa pelo Comitê de novo, como hoje.",
    titulo: "As parcelas saem de Títulos a Pagar.",
  },
  desembolso: {
    avaliacao: "O desembolso volta para “Em avaliação” na aba Pedidos de Desembolsos, para aprovar de novo ou rejeitar.",
    rejeitar: "O desembolso fica rejeitado, e quem pediu vê o motivo.",
    titulo: "As parcelas saem de Títulos a Pagar.",
  },
  folha: {
    avaliacao: "A linha volta para “Aguardando aprovação” na aba People, para corrigir e aprovar de novo.",
    rejeitar: "A linha volta para o RH corrigir (pendente de correção), com o motivo.",
    titulo: "O título sai de Títulos a Pagar.",
  },
};

export function ReverterAprovacaoDialog({
  origem,
  id,
  tituloId,
  descricao,
  valor,
  open,
  onOpenChange,
  aoReverter,
}: {
  origem: OrigemDaReversao;
  id?: string;
  tituloId?: string;
  descricao: string;
  valor: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  aoReverter?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [destino, setDestino] = React.useState<DestinoDaReversao | null>(null);
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setDestino(null);
      setMotivo("");
      setErro(null);
    }
  }, [open]);

  function confirmar(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setErro(null);
    if (!destino) {
      setErro("Escolha para onde o pedido volta.");
      return;
    }
    if (motivo.trim().length < 10) {
      setErro("Escreva o motivo (mínimo 10 caracteres).");
      return;
    }
    startTransition(async () => {
      const res = await reverterAprovacao({ origem, id, titulo_id: tituloId, destino, motivo: motivo.trim() });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onOpenChange(false);
      if (aoReverter) aoReverter();
      else router.refresh();
    });
  }

  const t = TEXTO[origem];
  const opcoes: Array<[DestinoDaReversao, string, string, typeof Undo2]> = [
    ["avaliacao", "Voltar para avaliação", t.avaliacao, Undo2],
    ["rejeitar", "Rejeitar", t.rejeitar, Ban],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Acima da tela da PP (z-[55]), de onde ele também abre.
        className="z-[60] max-w-lg"
        overlayClassName="z-[60]"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>Reverter aprovação</DialogTitle>
          <DialogDescription>
            {descricao} · {valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={confirmar} className="space-y-4">
          <div className="space-y-2">
            {opcoes.map(([valorOpcao, rotulo, dica, Icone]) => (
              <button
                key={valorOpcao}
                type="button"
                onClick={() => setDestino(valorOpcao)}
                aria-pressed={destino === valorOpcao}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors",
                  destino === valorOpcao ? "border-california-red bg-california-red/[0.04]" : "border-border hover:bg-muted/50",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    destino === valorOpcao ? "border-california-red" : "border-gray-300",
                  )}
                >
                  {destino === valorOpcao && <span className="h-2 w-2 rounded-full bg-california-red" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Icone className="h-3.5 w-3.5 text-muted-foreground" />
                    {rotulo}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{dica}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="motivo_reversao">Motivo</Label>
            <textarea
              id="motivo_reversao"
              rows={2}
              maxLength={500}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: valor aprovado errado"
              className="w-full resize-none rounded-lg border border-input bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
            />
            <p className="text-[11.5px] text-muted-foreground">
              {t.titulo} O motivo fica no histórico{destino === "rejeitar" ? " e aparece para quem enviou" : ""}.
            </p>
          </div>
          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-xs text-california-red">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erro}</span>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50"
            >
              <Undo2 className="h-4 w-4" />
              {pending ? "Revertendo..." : "Reverter"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
