"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cancelarAprovacaoVersao } from "../actions";
import { cancelarAprovacaoDoJobDevolvido } from "./abertura-actions";

interface Props {
  versaoId: string;
  /** "v1" — aparece na confirmação. */
  versaoLabel: string;
  status: string;
  temJobAtivo: boolean;
  /** Código do job vivo quando ele foi DEVOLVIDO pelo financeiro; `null`
   *  em qualquer outro caso. Com ele, o cancelamento da aprovação cancela
   *  o job e guarda o código para o próximo envio (decisão 128). */
  jobDevolvidoCodigo: string | null;
}

/**
 * Sobrou só o desfazer. "Aprovar versão" mudou para a barra de ação do
 * rodapé no handoff "Abertura de Job.dc.html" — ver `FluxoAbertura`.
 *
 * Desde 29/09/2026 (decisão 128) ele também aparece com o job devolvido
 * pelo financeiro: é o caminho para mudar o orçado. O job é cancelado, e o
 * código dele volta no próximo envio.
 */
export function AprovacaoActions({
  versaoId,
  versaoLabel,
  status,
  temJobAtivo,
  jobDevolvidoCodigo,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmando, setConfirmando] = React.useState<"cancelar" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const devolvido = jobDevolvidoCodigo !== null;
  const podeCancelarAprovacao =
    status === "aprovada" && (!temJobAtivo || devolvido);

  function handleCancelar() {
    setError(null);
    startTransition(async () => {
      const res = devolvido
        ? await cancelarAprovacaoDoJobDevolvido(versaoId)
        : await cancelarAprovacaoVersao(versaoId);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setConfirmando(null);
      router.refresh();
    });
  }

  if (!podeCancelarAprovacao) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirmando("cancelar");
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/40 bg-white px-3 py-1.5 text-xs font-semibold text-california-red hover:bg-california-red/5 transition-colors"
      >
        <Undo2 className="h-3.5 w-3.5" />
        Cancelar aprovação
      </button>

      <ConfirmDialog
        open={confirmando === "cancelar"}
        onOpenChange={(o) => !o && setConfirmando(null)}
        title={
          devolvido
            ? `Cancelar a aprovação da ${versaoLabel}?`
            : "Cancelar a aprovação desta versão?"
        }
        description={
          devolvido ? (
            <>
              O job{" "}
              <strong className="font-mono text-foreground">{jobDevolvidoCodigo}</strong>,
              devolvido pelo financeiro, é cancelado e sai das listas. A versão{" "}
              <strong className="text-foreground">{versaoLabel}</strong> volta a
              ser editável: dados do orçamento, orçado e planejado. Saves e BVs
              voltam para a versão.
              <span className="mt-3 block">
                Quando você aprovar de novo e enviar para abertura, o job volta
                com o mesmo código,{" "}
                <strong className="font-mono text-foreground">{jobDevolvidoCodigo}</strong>.
              </span>
              <span className="mt-3 block">
                Se houver PP gerada no job, cancele-a antes.
              </span>
              {error && (
                <span className="mt-3 block text-xs text-california-red">{error}</span>
              )}
            </>
          ) : (
            <>
              {"A versão volta pra 'em revisão'. As versões 'substituída' deste orçamento também voltam pra 'em revisão'. O orçamento volta pra 'em revisão'."}
              {error && (
                <span className="mt-3 block text-xs text-california-red">{error}</span>
              )}
            </>
          )
        }
        confirmLabel={devolvido ? "Sim, cancelar aprovação" : "Cancelar aprovação"}
        cancelLabel={devolvido ? "Voltar" : undefined}
        onConfirm={handleCancelar}
        pending={pending}
      />
    </>
  );
}
