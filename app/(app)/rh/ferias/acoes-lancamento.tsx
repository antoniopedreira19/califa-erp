"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, X, Search, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { FeriasLancamentoStatus } from "@/lib/types";
import {
  aprovarLancamento,
  reprovarLancamento,
  moverEmAnalise,
} from "./actions";

type Props = {
  lancamentoId: string;
  status: FeriasLancamentoStatus;
  colaboradorNome: string;
};

export function AcoesLancamento({
  lancamentoId,
  status,
  colaboradorNome,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmandoAprovar, setConfirmandoAprovar] = React.useState(false);
  const [reprovandoAberto, setReprovandoAberto] = React.useState(false);
  const [emAnaliseAberto, setEmAnaliseAberto] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [observacao, setObservacao] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);

  const podeAprovar =
    status === "pendente_aprovacao" || status === "em_analise";
  const podeReprovar = podeAprovar;
  const podeEmAnalise = status === "pendente_aprovacao";

  if (!podeAprovar && !podeReprovar && !podeEmAnalise) {
    return null;
  }

  function handleAprovar() {
    setErro(null);
    startTransition(async () => {
      const res = await aprovarLancamento(lancamentoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setConfirmandoAprovar(false);
      router.refresh();
    });
  }

  function handleReprovar() {
    setErro(null);
    startTransition(async () => {
      const res = await reprovarLancamento({
        lancamento_id: lancamentoId,
        motivo: motivo.trim(),
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setReprovandoAberto(false);
      setMotivo("");
      router.refresh();
    });
  }

  function handleEmAnalise() {
    setErro(null);
    startTransition(async () => {
      const res = await moverEmAnalise({
        lancamento_id: lancamentoId,
        observacao: observacao.trim() || null,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setEmAnaliseAberto(false);
      setObservacao("");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 shrink-0 flex-wrap">
      {podeEmAnalise && (
        <button
          type="button"
          onClick={() => setEmAnaliseAberto(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Search className="h-3 w-3" />
          Em análise
        </button>
      )}
      {podeReprovar && (
        <button
          type="button"
          onClick={() => setReprovandoAberto(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 transition-colors"
        >
          <X className="h-3 w-3" />
          Reprovar
        </button>
      )}
      {podeAprovar && (
        <button
          type="button"
          onClick={() => setConfirmandoAprovar(true)}
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
        >
          <Check className="h-3 w-3" />
          Aprovar
        </button>
      )}

      {/* Confirmação de aprovação */}
      <ConfirmDialog
        open={confirmandoAprovar}
        onOpenChange={(o) => {
          if (!o) {
            setConfirmandoAprovar(false);
            setErro(null);
          }
        }}
        title={`Aprovar férias de ${colaboradorNome}?`}
        description={
          <div className="space-y-2">
            <p>
              A solicitação muda para <strong>aprovado</strong>. O colaborador
              recebe notificação na página de perfil.
            </p>
            {erro && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {erro}
              </p>
            )}
          </div>
        }
        confirmLabel="Aprovar"
        pending={pending}
        onConfirm={handleAprovar}
      />

      {/* Dialog de reprovação */}
      <Dialog
        open={reprovandoAberto}
        onOpenChange={(o) => {
          setReprovandoAberto(o);
          if (!o) {
            setMotivo("");
            setErro(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reprovar solicitação</DialogTitle>
            <DialogDescription>
              Diga por que você está reprovando — essa mensagem chega pro{" "}
              {colaboradorNome} na notificação.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="motivo-reprov">Motivo</Label>
              <Textarea
                id="motivo-reprov"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex: data conflita com entrega de projeto X; já tem 2 do time nesse período..."
                rows={4}
                maxLength={500}
              />
            </div>

            {erro && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {erro}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setReprovandoAberto(false)}
              className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleReprovar}
              disabled={pending || motivo.trim().length < 5}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Reprovando..." : "Reprovar"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog de "em análise" */}
      <Dialog
        open={emAnaliseAberto}
        onOpenChange={(o) => {
          setEmAnaliseAberto(o);
          if (!o) {
            setObservacao("");
            setErro(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mover para análise</DialogTitle>
            <DialogDescription>
              A solicitação fica em espera enquanto você conversa com o{" "}
              {colaboradorNome}. Observação opcional vira notificação pra ele.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="obs-analise">Observação (opcional)</Label>
              <Textarea
                id="obs-analise"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Ex: podemos adiantar em 2 semanas? Confirma antes de aprovar."
                rows={3}
                maxLength={500}
              />
            </div>

            {erro && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {erro}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setEmAnaliseAberto(false)}
              className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleEmAnalise}
              disabled={pending}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Movendo..." : "Mover para análise"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
