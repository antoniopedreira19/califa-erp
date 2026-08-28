"use client";

/**
 * Reabrir uma fatura fechada.
 *
 * O motivo é obrigatório e vai para a auditoria junto com o valor cobrado
 * anterior. Reabrir desfaz contabilidade que já estava lançada — daqui a
 * três meses alguém vai querer saber por quê, e "o financeiro reabriu"
 * não responde nada.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Unlock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import type { FaturaDoCartao } from "./fechar-fatura-dialog";
import { reabrirFaturaCartao } from "./actions-fatura-cartao";

interface Props {
  fatura: FaturaDoCartao | null;
  onOpenChange: (aberto: boolean) => void;
  onSucesso: (mensagem: string) => void;
}

function formatData(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function ReabrirFaturaDialog({ fatura, onOpenChange, onSucesso }: Props) {
  const router = useRouter();
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);

  React.useEffect(() => {
    if (fatura) {
      setMotivo("");
      setErro(null);
    }
  }, [fatura]);

  const podeReabrir =
    fatura !== null && motivo.trim().length >= 3 && !salvando;

  async function confirmar() {
    if (!fatura) return;
    setSalvando(true);
    setErro(null);

    const r = await reabrirFaturaCartao({
      fatura_id: fatura.id,
      motivo: motivo.trim(),
    });

    setSalvando(false);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    onOpenChange(false);
    onSucesso(
      `${fatura.codigo} reaberta — os itens voltaram a "a pagar" e ela recebe compra de novo.`,
    );
    router.refresh();
  }

  return (
    <Dialog open={fatura !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[520px] overflow-y-auto">
        {fatura && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-lg bg-amber-50 p-2">
                  <Unlock className="h-4.5 w-4.5 text-amber-700" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-[19px]">
                    Reabrir fatura
                  </DialogTitle>
                  <DialogDescription className="pt-1.5 text-[13px] leading-relaxed">
                    <span className="font-mono font-semibold text-[#b3323c]">
                      {fatura.codigo}
                    </span>{" "}
                    · fechada em {formatData(fatura.competencia_fechamento)} por{" "}
                    <span className="font-mono font-semibold">
                      {formatCurrency(fatura.soma_itens)}
                    </span>
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 pt-1">
              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-900">
                <p>
                  <strong>O que reabrir faz:</strong> apaga os lançamentos que
                  o fechamento criou na conta do cartão, devolve os itens para
                  &ldquo;a pagar&rdquo; e tira o título de Títulos a Pagar. A
                  fatura volta a receber compra — inclusive retroativa.
                </p>
                <p>
                  Nada disso mexe em dinheiro: a fatura ainda não foi paga, e
                  os lançamentos do fechamento são recriados inteiros quando
                  você fechar de novo.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="motivo_reabertura">
                  Por que está reabrindo? *
                </Label>
                <Input
                  id="motivo_reabertura"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  maxLength={300}
                  placeholder="Ex.: faltou a compra do dia 12, o extrato veio R$ 80 maior"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Fica na auditoria junto com o valor cobrado anterior.
                </p>
              </div>

              {erro && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2.5"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-california-red" />
                  <span className="text-[12px] text-foreground">{erro}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  disabled={salvando}
                  className="inline-flex items-center rounded-lg border border-border bg-white px-3.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmar}
                  disabled={!podeReabrir}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Unlock className="h-3.5 w-3.5" />
                  {salvando ? "Reabrindo…" : "Reabrir fatura"}
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
