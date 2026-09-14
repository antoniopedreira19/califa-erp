"use client";

/** "Copiar itens de outro mês" — monta um mês VAZIO a partir de outro
 *  (decisão 078). Copiar para mês que já tem grupo não existe: é decisão
 *  do Tiago (14/09/2026), e o caso real é montar agosto a partir de julho.
 *
 *  Copia grupos e itens (orçado e planejado). BV e save não vêm: são do mês
 *  de origem. */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copiarItensDoMes } from "../meses-actions";

interface Props {
  destinoId: string;
  /** "julho". */
  destinoNome: string;
  /** Os outros meses da versão; só os que têm grupo podem ser origem. */
  origens: { id: string; rotulo: string; qtdGrupos: number; qtdItens: number }[];
  /** Presente ⇒ o botão fica desabilitado com este motivo. */
  bloqueio?: string;
}

export function CopiarItensDoMes({
  destinoId,
  destinoNome,
  origens,
  bloqueio,
}: Props) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const comGrupo = origens.filter((o) => o.qtdGrupos > 0);
  const motivo =
    bloqueio ??
    (comGrupo.length === 0 ? "Nenhum outro mês tem itens para copiar." : undefined);

  function copiar(origemId: string) {
    setErro(null);
    startTransition(async () => {
      const r = await copiarItensDoMes(origemId, destinoId);
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      setAberto(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={Boolean(motivo)}
        title={motivo}
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-foreground"
      >
        <Copy className="h-3.5 w-3.5" />
        Copiar itens de outro mês
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Copiar itens para {destinoNome}</DialogTitle>
            <DialogDescription>
              Os grupos e os itens do mês escolhido são copiados para{" "}
              {destinoNome}, com orçado e planejado. BV e save não vêm junto.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {comGrupo.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={pending}
                onClick={() => copiar(o.id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-white px-4 py-3 text-left transition-colors hover:border-california-red/40 hover:bg-california-red/[0.03] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-sm font-semibold">{o.rotulo}</span>
                <span className="text-xs text-muted-foreground">
                  {o.qtdGrupos === 1 ? "1 grupo" : `${o.qtdGrupos} grupos`} ·{" "}
                  {o.qtdItens === 1 ? "1 item" : `${o.qtdItens} itens`}
                </span>
              </button>
            ))}
          </div>
          {erro && (
            <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erro}</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
