"use client";

// O quadro vermelho do motivo e o pop-up de "Solicitar aprovação" (decisão
// 223). O mesmo quadro aparece para quem envia e para o Comitê.
import * as React from "react";
import { Gavel } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { LinhaDoMotivo } from "./linhas-do-motivo";

export {
  linhasDoMotivoDaPP,
  linhasDoMotivoDaVersao,
  type ItemAcimaDoOrcado,
  type LinhaDoMotivo,
} from "./linhas-do-motivo";

export function MotivoDoCaso({ linhas }: { linhas: LinhaDoMotivo[] }) {
  if (linhas.length === 0) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-3">
      <ul className="space-y-1.5 text-[13px]">
        {linhas.map((l, i) => (
          <li key={`${l.rotulo}-${i}`} className="flex flex-col">
            <span className="font-medium">{l.rotulo}</span>
            <span className="font-mono text-[12.5px]">{l.valor}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** O pedido ao Comitê, com o motivo obrigatório: o mesmo pop-up para a
 *  versão e para a PP. `onEnviar` devolve a mensagem de erro, ou `null`. */
export function SolicitarAprovacaoDialog({
  aberto,
  titulo,
  descricao,
  linhas,
  motivoInicial = "",
  placeholder,
  onFechar,
  onEnviar,
}: {
  aberto: boolean;
  titulo: string;
  descricao: string;
  linhas: LinhaDoMotivo[];
  motivoInicial?: string;
  placeholder: string;
  onFechar: () => void;
  onEnviar: (motivo: string) => Promise<string | null>;
}) {
  const [motivo, setMotivo] = React.useState(motivoInicial);
  const [erro, setErro] = React.useState<string | null>(null);
  const [enviando, startTransition] = React.useTransition();
  React.useEffect(() => {
    if (aberto) {
      setMotivo(motivoInicial);
      setErro(null);
    }
  }, [aberto, motivoInicial]);

  function enviar() {
    const texto = motivo.trim();
    if (!texto) {
      setErro("Escreva o motivo para enviar.");
      return;
    }
    setErro(null);
    startTransition(async () => {
      const falha = await onEnviar(texto);
      if (falha) setErro(falha);
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && !enviando && onFechar()}>
      <DialogContent className="max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <MotivoDoCaso linhas={linhas} />
        <div>
          <label htmlFor="motivo-do-envio" className="mb-1.5 block text-[13px] font-semibold">
            Motivo *
          </label>
          <Textarea
            id="motivo-do-envio"
            rows={3}
            maxLength={2000}
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value);
              setErro(null);
            }}
            placeholder={placeholder}
          />
          {erro && <p className="mt-1.5 text-[12px] font-medium text-california-red">{erro}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={enviando}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={enviar}
            disabled={enviando}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-60"
          >
            <Gavel className="h-4 w-4" />
            {enviando ? "Enviando…" : "Solicitar aprovação"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
