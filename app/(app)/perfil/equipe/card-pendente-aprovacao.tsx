"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  aprovarLancamentoComoLider,
  reprovarLancamentoComoLider,
} from "./actions";

export type CardPendenteProps = {
  lancamento: {
    id: string;
    colaboradorNome: string;
    dataInicio: string; // YYYY-MM-DD
    dataFim: string;
    dias: number;
    diasAbono: number;
    tipoLabel: string;
    observacao: string | null;
  };
};

function fmtData(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("pt-BR");
}

export function CardPendenteAprovacao({ lancamento }: CardPendenteProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [reprovando, setReprovando] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [erroMotivo, setErroMotivo] = React.useState<string | null>(null);

  function aprovar() {
    setErro(null);
    startTransition(async () => {
      const res = await aprovarLancamentoComoLider({
        lancamentoId: lancamento.id,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      router.refresh();
    });
  }

  function confirmarReprovacao() {
    setErroMotivo(null);
    const trimmed = motivo.trim();
    if (trimmed.length < 3) {
      setErroMotivo("Explique em pelo menos 3 caracteres.");
      return;
    }
    startTransition(async () => {
      const res = await reprovarLancamentoComoLider({
        lancamentoId: lancamento.id,
        motivo: trimmed,
      });
      if (!res.ok) {
        setErroMotivo(res.message);
        return;
      }
      setReprovando(false);
      setMotivo("");
      router.refresh();
    });
  }

  const { dataInicio, dataFim, dias, diasAbono, tipoLabel, observacao } =
    lancamento;

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">
            {lancamento.colaboradorNome}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>
              {fmtData(dataInicio)} – {fmtData(dataFim)}
            </span>
            <span>·</span>
            <span>
              {dias} {dias === 1 ? "dia" : "dias"}
              {diasAbono > 0 ? ` (${diasAbono} abono)` : ""}
            </span>
            <span>·</span>
            <span>{tipoLabel}</span>
          </div>
          {observacao ? (
            <p className="mt-2 rounded-md bg-muted/40 p-2 text-sm text-muted-foreground">
              {observacao}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReprovando(true)}
            disabled={isPending}
            className="text-red-700 hover:bg-red-50"
          >
            <XCircle className="h-4 w-4" />
            Reprovar
          </Button>
          <Button
            size="sm"
            onClick={aprovar}
            disabled={isPending}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <CheckCircle2 className="h-4 w-4" />
            Aprovar
          </Button>
        </div>
      </div>
      {erro ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {erro}
        </p>
      ) : null}

      <Dialog
        open={reprovando}
        onOpenChange={(open) => {
          if (!open) {
            setReprovando(false);
            setMotivo("");
            setErroMotivo(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reprovar solicitação de férias</DialogTitle>
            <DialogDescription>
              Explique o motivo. O colaborador vai ver esta mensagem.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="motivo-reprovacao">Motivo</Label>
            <Textarea
              id="motivo-reprovacao"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: período coincide com um lançamento importante."
              rows={4}
              maxLength={500}
              disabled={isPending}
            />
            {erroMotivo ? (
              <p className="text-sm text-red-700">{erroMotivo}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReprovando(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmarReprovacao}
              disabled={isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              Confirmar reprovação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
