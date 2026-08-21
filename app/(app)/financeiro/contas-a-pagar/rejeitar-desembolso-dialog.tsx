"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { rejeitarDesembolso, cancelarDesembolso } from "@/app/(app)/financeiro/desembolsos/actions";

/**
 * Dialog reutilizável para rejeitar OU cancelar um desembolso.
 * O `modo` controla o título, a descrição, o botão e qual action é chamada.
 */

export type ModoDialog = "rejeitar" | "cancelar";

export interface DesembolsoParaRejeitar {
  id: string;
  codigo: string;
  descricao: string;
  valor: number;
  fornecedor_nome: string;
}

interface RejeitarDesembolsoDialogProps {
  desembolso: DesembolsoParaRejeitar | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modo: ModoDialog;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const MODO_CONFIG: Record<
  ModoDialog,
  {
    titulo: string;
    descricao: string;
    placeholder: string;
    btnLabel: string;
    btnLabelPending: string;
    btnClass: string;
  }
> = {
  rejeitar: {
    titulo: "Rejeitar desembolso",
    descricao: "Informe o motivo da rejeição. O solicitante poderá ver esta justificativa.",
    placeholder: "Descreva o motivo da rejeição (mínimo 10 caracteres)…",
    btnLabel: "Confirmar rejeição",
    btnLabelPending: "Rejeitando…",
    btnClass: "bg-red-600 hover:bg-red-700 text-white",
  },
  cancelar: {
    titulo: "Cancelar desembolso",
    descricao: "Informe o motivo do cancelamento. O desembolso será encerrado permanentemente.",
    placeholder: "Descreva o motivo do cancelamento (mínimo 10 caracteres)…",
    btnLabel: "Confirmar cancelamento",
    btnLabelPending: "Cancelando…",
    btnClass: "bg-slate-600 hover:bg-slate-700 text-white",
  },
};

export function RejeitarDesembolsoDialog({
  desembolso,
  open,
  onOpenChange,
  modo,
}: RejeitarDesembolsoDialogProps) {
  const router = useRouter();
  const [motivo, setMotivo] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  const cfg = MODO_CONFIG[modo];

  // Resetar ao abrir
  React.useEffect(() => {
    if (open) {
      setMotivo("");
      setErro(null);
    }
  }, [open]);

  async function handleConfirmar() {
    if (!desembolso) return;
    setPending(true);
    setErro(null);
    const action = modo === "rejeitar" ? rejeitarDesembolso : cancelarDesembolso;
    const res = await action({
      desembolso_id: desembolso.id,
      motivo,
    });
    setPending(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  if (!desembolso) return null;

  const motivoValido = motivo.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{cfg.titulo}</DialogTitle>
          <DialogDescription>{cfg.descricao}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Resumo */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-sm">
            <p>
              <span className="font-mono font-bold text-california-red">{desembolso.codigo}</span>
              {" — "}
              <span className="font-semibold">{formatMoney(desembolso.valor)}</span>
            </p>
            <p className="text-muted-foreground">{desembolso.descricao}</p>
            {desembolso.fornecedor_nome && (
              <p className="text-muted-foreground">Fornecedor: {desembolso.fornecedor_nome}</p>
            )}
          </div>

          {/* Motivo */}
          <div className="space-y-1.5">
            <Label htmlFor={`motivo-desembolso-${modo}`}>
              Motivo <span className="text-muted-foreground text-xs">(mín. 10 caracteres)</span>
            </Label>
            <Textarea
              id={`motivo-desembolso-${modo}`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={cfg.placeholder}
              rows={4}
              maxLength={500}
              className="resize-none"
            />
            <p className="text-right text-xs text-muted-foreground">
              {motivo.trim().length}/500
            </p>
          </div>

          {/* Erro */}
          {erro && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Voltar
          </Button>
          <Button
            type="button"
            onClick={handleConfirmar}
            disabled={pending || !motivoValido}
            className={cfg.btnClass}
          >
            {pending ? cfg.btnLabelPending : cfg.btnLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
