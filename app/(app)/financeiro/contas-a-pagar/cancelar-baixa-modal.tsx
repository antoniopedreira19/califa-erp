"use client";

/**
 * ⚠️ SEM PORTA NA UI desde a Tela 3.2 (17/08/2026).
 *
 * Decisão do Tiago: seguir o protótipo à risca, que não tem estorno em
 * lugar nenhum — título pago exibe apenas "Conciliação". Este componente
 * e a action `estornarBaixaParcela` continuam no repositório,
 * funcionando, mas nenhuma tela os monta. Reverter uma baixa errada hoje
 * exige intervenção fora da tela.
 *
 * ✅ 18/08/2026 — o aviso que estava aqui foi resolvido. Ele dizia que o
 * estorno tinha sido escrito para a PP INTEIRA enquanto a baixa virara
 * por PARCELA, e que faltava uma RPC equivalente antes de religar. O
 * Tiago fechou a regra ("cada baixa ou estorno deverá ser feito por
 * parcela; a aprovação é por PP"), nasceu a
 * `estornar_baixa_pp_parcela` e este modal já aponta para ela. Religar
 * agora é só montá-lo em algum lugar — a semântica está certa.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { estornarBaixaParcela } from "./actions-titulos";

interface Props {
  /** A PARCELA cuja baixa se quer reverter — a unidade do estorno desde
   *  18/08/2026. `rotulo` é como ela aparece na tela: "PP-00009 · 2/3". */
  parcela: { id: string; rotulo: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CancelarBaixaModal({ parcela, open, onOpenChange }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [motivo, setMotivo] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setErro(null);
    setMotivo("");
  }, [open, parcela]);

  function handleSubmit() {
    setErro(null);
    startTransition(async () => {
      const res = await estornarBaixaParcela({
        parcela_id: parcela.id,
        motivo,
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
            Cancelar baixa de {parcela.rotulo}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          A parcela volta para{" "}
          <span className="font-medium text-foreground">A pagar</span> e a PP,
          se estava paga, volta para{" "}
          <span className="font-medium text-foreground">Aprovada</span>. Um
          lançamento reverso é gerado na mesma conta bancária, mantendo o
          histórico contábil. O motivo fica no log de auditoria.
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
          >
            {pending ? "Confirmando..." : "Confirmar estorno"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
