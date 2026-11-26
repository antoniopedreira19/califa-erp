"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { enviarFolhaCLT } from "../envio-actions";

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export interface ModalEnviarFolhaCLTProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ano: number;
  mes: number;
  linhasRascunho: number;
  linhasPendenteCorrecao: number;
  onEnviado?: (linhasEnviadas: number) => void;
}

export function ModalEnviarFolhaCLT(
  props: ModalEnviarFolhaCLTProps,
): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  const totalLinhas = props.linhasRascunho + props.linhasPendenteCorrecao;
  const competenciaLabel = `${NOMES_MES[props.mes - 1]}/${props.ano}`;

  // Limpar erro quando o modal abre/fecha.
  React.useEffect(() => {
    if (!props.open) return;
    setErro(null);
  }, [props.open]);

  function handleEnviar() {
    setErro(null);
    startTransition(async () => {
      const r = await enviarFolhaCLT({ ano: props.ano, mes: props.mes });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      props.onEnviado?.(r.linhas_enviadas);
      props.onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(v) => {
        if (!pending) props.onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar folha CLT · {competenciaLabel}</DialogTitle>
          <DialogDescription>
            Linhas CLT serão enviadas para aprovação do financeiro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-foreground">
            <span className="font-semibold tabular-nums">{totalLinhas}</span>{" "}
            {totalLinhas === 1 ? "linha CLT" : "linhas CLT"} serão enviadas para
            aprovação do financeiro.
          </p>

          {props.linhasPendenteCorrecao > 0 && (
            <p className="text-xs text-muted-foreground">
              Inclui{" "}
              <span className="font-medium">{props.linhasPendenteCorrecao}</span>{" "}
              {props.linhasPendenteCorrecao === 1
                ? "linha corrigida que estava pendente."
                : "linhas corrigidas que estavam pendentes."}
            </p>
          )}

          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{erro}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => props.onOpenChange(false)}
            disabled={pending}
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleEnviar}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {pending ? "Enviando..." : "Enviar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
