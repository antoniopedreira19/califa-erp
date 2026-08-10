"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { estornarBaixaAvulsa } from "../../actions-avulsas";

interface Props {
  contaId: string;
  descricao: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CancelarBaixaAvulsaModal({
  contaId,
  descricao,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [motivo, setMotivo] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setErro(null);
    setMotivo("");
  }, [open, contaId]);

  function handleSubmit() {
    setErro(null);
    if (motivo.trim().length < 10) {
      setErro("O motivo precisa ter pelo menos 10 caracteres.");
      return;
    }
    startTransition(async () => {
      const res = await estornarBaixaAvulsa({
        conta_avulsa_id: contaId,
        motivo: motivo.trim(),
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-california-red" />
            Cancelar baixa da conta avulsa
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          A conta{" "}
          <span className="font-medium text-foreground">&quot;{descricao}&quot;</span>{" "}
          volta ao status <span className="font-medium text-foreground">Pendente</span>.
          Um lançamento reverso é gerado na conta bancária, mantendo o histórico contábil.
          O motivo fica no log de auditoria.
        </p>

        {erro && (
          <div className="flex items-start gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium">
            Motivo * (mín. 10 caracteres)
          </label>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full rounded border border-border p-2 text-sm"
            placeholder="Ex: valor lançado divergia do valor real pago. Conta bancária errada."
          />
          <p className="text-[11px] text-muted-foreground">
            {motivo.trim().length}/500 caracteres
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending || motivo.trim().length < 10}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50"
          >
            {pending ? "Confirmando..." : "Confirmar estorno"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
