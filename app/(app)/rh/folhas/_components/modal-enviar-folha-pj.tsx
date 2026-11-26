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
import { previsualizarAplicacao } from "@/lib/actions/beneficios/fechamento";
import { enviarFolhaPJ } from "../envio-actions";
import type { PreviewAplicacao } from "@/lib/types";

const brl = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function formatarData(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

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

export interface ModalEnviarFolhaPJProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ano: number;
  mes: number;
  linhasRascunho: number;
  linhasPendenteCorrecao: number;
  beneficiosAplicado: boolean;
  onEnviado?: (linhasEnviadas: number) => void;
}

export function ModalEnviarFolhaPJ(
  props: ModalEnviarFolhaPJProps,
): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erroPreview, setErroPreview] = React.useState<string | null>(null);
  const [erroEnvio, setErroEnvio] = React.useState<string | null>(null);
  const [erroBloqueia, setErroBloqueia] = React.useState(false);
  const [carregandoPreview, setCarregandoPreview] = React.useState(false);
  const [preview, setPreview] = React.useState<PreviewAplicacao | null>(null);

  const totalLinhas = props.linhasRascunho + props.linhasPendenteCorrecao;
  const competenciaLabel = `${NOMES_MES[props.mes - 1]}/${props.ano}`;

  // Quando o modal abre: limpar estado e, se necessário, buscar preview.
  React.useEffect(() => {
    if (!props.open) {
      setErroPreview(null);
      setErroEnvio(null);
      setErroBloqueia(false);
      setPreview(null);
      setCarregandoPreview(false);
      return;
    }

    setErroPreview(null);
    setErroEnvio(null);
    setErroBloqueia(false);
    setPreview(null);

    if (props.beneficiosAplicado) return;

    let ativo = true;
    setCarregandoPreview(true);

    (async () => {
      const r = await previsualizarAplicacao({ ano: props.ano, mes: props.mes });
      if (!ativo) return;
      setCarregandoPreview(false);
      if (!r.ok) {
        const isCatalogoIncompleto = r.message
          .toLowerCase()
          .includes("catalogo_incompleto");
        setErroPreview(r.message);
        setErroBloqueia(isCatalogoIncompleto);
        return;
      }
      setPreview(r.preview);
    })();

    return () => { ativo = false; };
  }, [props.open, props.ano, props.mes, props.beneficiosAplicado]);

  function handleEnviar() {
    setErroEnvio(null);
    startTransition(async () => {
      const r = await enviarFolhaPJ({ ano: props.ano, mes: props.mes });
      if (!r.ok) {
        setErroEnvio(r.message);
        return;
      }
      props.onEnviado?.(r.linhas_enviadas);
      props.onOpenChange(false);
      router.refresh();
    });
  }

  const botaoEnviarDesabilitado =
    pending ||
    erroBloqueia ||
    (!props.beneficiosAplicado && carregandoPreview);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(v) => {
        if (!pending) props.onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar folha PJ · {competenciaLabel}</DialogTitle>
          <DialogDescription>
            A folha PJ e os benefícios da competência serão enviados ao
            financeiro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ---- Benefícios já aplicados: corpo simples ---- */}
          {props.beneficiosAplicado && (
            <>
              <p className="text-sm text-foreground">
                Benefícios já aplicados nesta competência.
              </p>
              <p className="text-sm text-foreground">
                <span className="font-semibold tabular-nums">{totalLinhas}</span>{" "}
                {totalLinhas === 1 ? "linha PJ" : "linhas PJ"} será
                {totalLinhas === 1 ? "" : "o"} enviada
                {totalLinhas === 1 ? "" : "s"} para aprovação do financeiro.
              </p>
              {props.linhasPendenteCorrecao > 0 && (
                <p className="text-xs text-muted-foreground">
                  Inclui{" "}
                  <span className="font-medium">
                    {props.linhasPendenteCorrecao}
                  </span>{" "}
                  {props.linhasPendenteCorrecao === 1
                    ? "linha corrigida que estava pendente."
                    : "linhas corrigidas que estavam pendentes."}
                </p>
              )}
            </>
          )}

          {/* ---- Preview: carregando ---- */}
          {!props.beneficiosAplicado && carregandoPreview && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Calculando descontos da competência...
            </div>
          )}

          {/* ---- Preview: erro de preview (bloqueante ou não) ---- */}
          {!props.beneficiosAplicado && erroPreview && !carregandoPreview && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{erroPreview}</span>
            </div>
          )}

          {/* ---- Preview: sem vínculos ativos ---- */}
          {!props.beneficiosAplicado &&
            !carregandoPreview &&
            preview !== null &&
            preview.qtdVinculos === 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-sky-700" />
                <span>
                  Nenhum vínculo ativo de benefícios nesta competência — PJ será
                  enviada sem desconto nem avulsa de operadora.
                </span>
              </div>
            )}

          {/* ---- Preview: dados completos ---- */}
          {!props.beneficiosAplicado &&
            !carregandoPreview &&
            preview !== null &&
            preview.qtdVinculos > 0 && (
              <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Vai acontecer, numa única transação:
                </p>
                <ol className="space-y-2 text-sm text-foreground list-decimal list-inside">
                  <li>
                    Descontar{" "}
                    <span className="font-semibold tabular-nums text-california-red">
                      {brl(preview.totalColaborador)}
                    </span>{" "}
                    das linhas PJ (benefícios)
                  </li>
                  {preview.porOperadora.map((op) => (
                    <li key={op.operadora}>
                      Gerar avulsa{" "}
                      <span className="font-medium">{op.operadora}</span>{" "}
                      <span className="font-semibold tabular-nums">
                        {brl(op.valorIntegral)}
                      </span>{" "}
                      (vence {formatarData(op.dataVencimento)})
                    </li>
                  ))}
                  <li>
                    Enviar{" "}
                    <span className="font-semibold tabular-nums">
                      {totalLinhas}
                    </span>{" "}
                    {totalLinhas === 1 ? "linha PJ" : "linhas PJ"} para aprovação
                    do financeiro
                  </li>
                </ol>

                {props.linhasPendenteCorrecao > 0 && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Inclui{" "}
                    <span className="font-medium">
                      {props.linhasPendenteCorrecao}
                    </span>{" "}
                    {props.linhasPendenteCorrecao === 1
                      ? "linha corrigida que estava pendente."
                      : "linhas corrigidas que estavam pendentes."}
                  </p>
                )}
              </div>
            )}

          {/* ---- Erro de envio (após clicar Enviar) — sempre acima do rodapé ---- */}
          {!pending && erroEnvio && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{erroEnvio}</span>
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
            disabled={botaoEnviarDesabilitado}
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
