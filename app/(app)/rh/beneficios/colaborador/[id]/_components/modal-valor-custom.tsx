"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";
import {
  definirOverrideBeneficio,
  removerOverrideBeneficio,
} from "@/lib/actions/beneficios/vinculos";

const formatarBrl = (n: number) =>
  n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });

export function ModalValorCustom({
  vinculoId,
  beneficioNome,
  valorPadraoColaborador,
  overrideAtual,
  motivoAtual,
  open,
  onClose,
}: {
  vinculoId: string;
  beneficioNome: string;
  /** Quanto o colaborador pagaria sem override (titular + deps). */
  valorPadraoColaborador: number | null;
  overrideAtual: number | null;
  motivoAtual: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [valor, setValor] = useState<string>(
    overrideAtual !== null ? String(overrideAtual) : "",
  );
  const [motivo, setMotivo] = useState(motivoAtual ?? "");
  const [erro, setErro] = useState<string | null>(null);

  const temOverride = overrideAtual !== null;

  function salvar() {
    setErro(null);
    const valorNum = Number(valor);
    if (!valor || Number.isNaN(valorNum) || valorNum < 0) {
      setErro("Informe um valor válido (R$).");
      return;
    }
    if (motivo.trim().length < 3) {
      setErro("Motivo é obrigatório (mínimo 3 caracteres).");
      return;
    }
    start(async () => {
      const res = await definirOverrideBeneficio({
        vinculoId,
        valor: valorNum,
        motivo: motivo.trim(),
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  function remover() {
    if (
      !confirm(
        "Remover o valor custom e voltar ao cálculo padrão pela tabela?",
      )
    ) {
      return;
    }
    setErro(null);
    start(async () => {
      const res = await removerOverrideBeneficio({ vinculoId });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Valor custom — {beneficioNome}</DialogTitle>
          <DialogDescription>
            Define um desconto em folha diferente do calculado pela tabela. Vale
            a partir do próximo fechamento mensal. A operadora continua
            recebendo o valor cheio; a California cobre a diferença.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            Pelo cálculo padrão, o colaborador pagaria{" "}
            <strong className="text-foreground">
              {valorPadraoColaborador !== null
                ? formatarBrl(valorPadraoColaborador)
                : "—"}
            </strong>{" "}
            neste benefício (titular + dependentes).
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              Colaborador paga (R$)
            </label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              disabled={pending}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
              placeholder="0,00"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              Motivo <span className="text-california-red">*</span>
            </label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={pending}
              rows={3}
              maxLength={500}
              className="w-full resize-none rounded-md border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
              placeholder="Ex: acordo negociado na contratação, desconto temporário autorizado por X, etc."
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Fica visível no card do vínculo. Toda mudança é registrada em
              auditoria.
            </p>
          </div>

          {erro && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>{erro}</div>
            </div>
          )}
        </div>

        <DialogFooter className="justify-between sm:justify-between">
          {temOverride ? (
            <button
              type="button"
              onClick={remover}
              disabled={pending}
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              Remover custom
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={pending}
              className="rounded-md bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 disabled:opacity-50"
            >
              {pending ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
