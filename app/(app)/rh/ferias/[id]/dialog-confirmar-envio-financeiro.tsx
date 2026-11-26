"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { enviarProFinanceiro } from "../actions";

export function DialogConfirmarEnvioFinanceiro({
  aberto,
  lancamentoId,
  totalFolhasRascunho,
  valorTotal,
  dataPagamentoDefault,
  onFechar,
}: {
  aberto: boolean;
  lancamentoId: string;
  totalFolhasRascunho: number;
  valorTotal: number;
  dataPagamentoDefault: string;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [data, setData] = React.useState<string>(dataPagamentoDefault);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (aberto) {
      setData(dataPagamentoDefault);
      setErro(null);
    }
  }, [aberto, dataPagamentoDefault]);

  function handleConfirmar() {
    setErro(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      setErro("Informe uma data de pagamento válida.");
      return;
    }
    startTransition(async () => {
      const res = await enviarProFinanceiro(lancamentoId, {
        dataPagamento: data,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onFechar();
      router.refresh();
    });
  }

  const valorFmt = valorTotal.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !pending && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar ao financeiro</DialogTitle>
          <DialogDescription>
            Serão enviadas {totalFolhasRascunho} folha
            {totalFolhasRascunho === 1 ? "" : "s"} com valor total de{" "}
            <span className="font-mono font-semibold">R$ {valorFmt}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="data-pag">Data de pagamento</Label>
            <Input
              id="data-pag"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Padrão: 2 dias antes do início das férias. Pode ajustar se
              precisar.
            </p>
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
            onClick={onFechar}
            disabled={pending}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmar}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {pending ? "Enviando..." : "Confirmar envio"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
