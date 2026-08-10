"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { CreditCard, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import type { ContaBancaria } from "@/lib/types";
import { darBaixaAvulsa } from "../../actions-avulsas";

interface Props {
  contaId: string;
  descricao: string;
  valor: number;
  contas: ContaBancaria[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BaixarAvulsaModal({
  contaId,
  descricao,
  valor,
  contas,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [pagoEm, setPagoEm] = React.useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [contaId_, setContaId_] = React.useState<string>("");

  React.useEffect(() => {
    if (!open) return;
    setErro(null);
    setPagoEm(format(new Date(), "yyyy-MM-dd"));
    setContaId_("");
  }, [open, contaId]);

  function handleSubmit() {
    setErro(null);
    if (!contaId_ || !pagoEm) {
      setErro("Preencha todos os campos obrigatórios.");
      return;
    }
    startTransition(async () => {
      const res = await darBaixaAvulsa({
        conta_avulsa_id: contaId,
        pago_em: pagoEm,
        conta_bancaria_id: contaId_,
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            Dar baixa na conta avulsa
          </DialogTitle>
        </DialogHeader>

        {erro && (
          <div className="flex items-start gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-md bg-muted/40 p-3 text-sm">
          <span className="text-muted-foreground">Descrição</span>
          <span className="font-medium truncate">{descricao}</span>
          <span className="text-muted-foreground">Valor</span>
          <span className="font-mono font-semibold">{formatCurrency(valor, "BRL")}</span>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Data do pagamento *</label>
            <DatePicker
              name="pago_em"
              defaultValue={pagoEm}
              onDateChange={(d) => {
                if (!d) {
                  setPagoEm("");
                  return;
                }
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, "0");
                const day = String(d.getDate()).padStart(2, "0");
                setPagoEm(`${y}-${m}-${day}`);
              }}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Conta bancária *</label>
            <Select value={contaId_} onValueChange={setContaId_}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a conta..." />
              </SelectTrigger>
              <SelectContent>
                {contas.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Nenhuma conta ativa para esta empresa. Cadastre em /cadastros/contas-bancarias.
                  </div>
                ) : (
                  contas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome} · {c.banco}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <CreditCard className="h-4 w-4" />
            {pending ? "Confirmando..." : "Confirmar baixa"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
