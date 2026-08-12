"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CornerUpLeft, MessageSquare, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { rejeitarAberturaJob } from "@/app/(app)/jobs/actions";
import { cn } from "@/lib/utils";

const MAX_MOTIVO = 500;
const MIN_MOTIVO = 10;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobCodigo: string;
  gpNome: string | null;
  produtorNome: string | null;
  /** Para onde ir depois de reprovar. Da fila, fica onde está. */
  redirecionarPara?: string;
}

/**
 * Reprovar devolve o job para a produção com uma justificativa. Usado
 * tanto na fila (pelo modal de conferência) quanto no formulário de
 * abertura — o design oferece a saída nos dois lugares.
 */
export function ReprovarDialog({
  open,
  onOpenChange,
  jobId,
  jobCodigo,
  gpNome,
  produtorNome,
  redirecionarPara,
}: Props) {
  const router = useRouter();
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [tentouEnviar, setTentouEnviar] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  // Reabrir o modal não deve trazer de volta o texto de uma reprovação
  // que foi cancelada.
  React.useEffect(() => {
    if (open) {
      setMotivo("");
      setErro(null);
      setTentouEnviar(false);
    }
  }, [open]);

  const curto = motivo.trim().length < MIN_MOTIVO;
  const mostrarErroCampo = tentouEnviar && curto;

  function handleEnviar() {
    setTentouEnviar(true);
    if (curto) return;

    setErro(null);
    const formData = new FormData();
    formData.set("motivo", motivo.trim());

    startTransition(async () => {
      const res = await rejeitarAberturaJob(jobId, formData);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onOpenChange(false);
      if (redirecionarPara) router.push(redirecionarPara);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-california-red/10 text-california-red">
            <CornerUpLeft className="h-5 w-5" />
          </div>
          <DialogTitle className="pt-4 text-[19px]">
            Reprovar a abertura de {jobCodigo}?
          </DialogTitle>
          <DialogDescription className="text-[13.5px] leading-relaxed">
            Escreva o que precisa ser modificado para o job ser aberto. A
            justificativa fica registrada na página do job, para a produção
            corrigir e reenviar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2.5">
            <label
              htmlFor="motivo-reprovacao"
              className="text-[12.5px] font-semibold"
            >
              Justificativa <span className="text-california-red">*</span>
            </label>
            <span className="font-mono text-[11px] text-muted-foreground">
              {motivo.length}/{MAX_MOTIVO}
            </span>
          </div>
          <textarea
            id="motivo-reprovacao"
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value.slice(0, MAX_MOTIVO));
              setTentouEnviar(false);
            }}
            rows={4}
            className={cn(
              "min-h-[104px] w-full resize-y rounded-lg border bg-white px-3.5 py-3 text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-california-red/20",
              mostrarErroCampo ? "border-california-red" : "border-border",
            )}
            placeholder="Ex.: a competência informada não fecha com o período do job e o custo de equipe está sem o coordenador de campo. Ajustar e reenviar."
          />
          {mostrarErroCampo && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-california-red">
              <AlertCircle className="h-3 w-3" />
              Escreva a justificativa com pelo menos {MIN_MOTIVO} caracteres.
            </span>
          )}
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 px-3.5 py-3">
          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Quem precisa corrigir:{" "}
            <strong className="text-foreground">{gpNome ?? "GP do job"}</strong>{" "}
            (GP)
            {produtorNome && (
              <>
                {" "}
                e{" "}
                <strong className="text-foreground">{produtorNome}</strong>{" "}
                (produtor)
              </>
            )}
            . O job sai da fila de abertura com status{" "}
            <strong className="text-foreground">
              Rejeitado pelo financeiro
            </strong>
            .
          </p>
        </div>

        {erro && (
          <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold transition-colors hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleEnviar}
            disabled={pending || curto}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Send className="h-4 w-4" />
            {pending ? "Enviando..." : "Enviar justificativa"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
