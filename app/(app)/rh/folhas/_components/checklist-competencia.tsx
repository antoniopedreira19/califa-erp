"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Square, Upload, Send, Loader2 } from "lucide-react";
import { enviarCompetencia } from "../importar-actions";
import { ImportarFolhaModal } from "./importar-folha-modal";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export interface ChecklistCompetenciaProps {
  ano: number;
  mes: number;
  pj: { linhas: number; total: number };
  clt: { linhas: number; total: number };
  rascunhosAEnviar: number;
  podeEditar: boolean;
}

export function ChecklistCompetencia(props: ChecklistCompetenciaProps) {
  const router = useRouter();
  const [pendingEnviar, startEnviar] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [sucesso, setSucesso] = React.useState<string | null>(null);

  const temPj = props.pj.linhas > 0;
  const temClt = props.clt.linhas > 0;
  const podeEnviar = temPj && temClt && props.rascunhosAEnviar > 0;

  function handleEnviar() {
    if (!podeEnviar) return;
    if (
      !confirm(
        `Enviar ${props.rascunhosAEnviar} linha${props.rascunhosAEnviar === 1 ? "" : "s"} desta competência ao financeiro? A aprovação continua em Contas a Pagar.`,
      )
    ) {
      return;
    }
    setErro(null);
    setSucesso(null);
    startEnviar(async () => {
      const r = await enviarCompetencia({ ano: props.ano, mes: props.mes });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      setSucesso(
        `${r.linhas_enviadas} linha${r.linhas_enviadas === 1 ? "" : "s"} enviada${r.linhas_enviadas === 1 ? "" : "s"} ao financeiro.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Status da competência
          </p>
          <h3 className="mt-1 text-lg font-semibold">
            Entregar PJ + CLT ao financeiro
          </h3>
        </div>
        {props.podeEditar && (
          <button
            type="button"
            onClick={handleEnviar}
            disabled={!podeEnviar || pendingEnviar}
            title={
              !temPj
                ? "Gere a folha PJ antes."
                : !temClt
                  ? "Importe a folha CLT antes."
                  : props.rascunhosAEnviar === 0
                    ? "Nenhum rascunho para enviar."
                    : undefined
            }
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {pendingEnviar ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {pendingEnviar ? "Enviando..." : "Enviar ao financeiro"}
          </button>
        )}
      </div>

      {erro && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {erro}
        </div>
      )}
      {sucesso && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {sucesso}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CheckpointRow
          feito={temPj}
          rotulo="PJ gerada"
          detalhe={
            temPj
              ? `${props.pj.linhas} linha${props.pj.linhas === 1 ? "" : "s"} · ${brl.format(props.pj.total)}`
              : "Nenhuma linha gerada ainda"
          }
        />
        <CheckpointRow
          feito={temClt}
          rotulo="CLT importada"
          detalhe={
            temClt
              ? `${props.clt.linhas} linha${props.clt.linhas === 1 ? "" : "s"} · ${brl.format(props.clt.total)}`
              : "Nenhuma linha importada ainda"
          }
          acao={
            props.podeEditar ? (
              <ImportarFolhaModal
                ano={props.ano}
                mes={props.mes}
                triggerLabel={
                  temClt ? (
                    <>
                      <Upload className="h-3.5 w-3.5" />
                      Reimportar
                    </>
                  ) : (
                    <>
                      <Upload className="h-3.5 w-3.5" />
                      Importar CLT
                    </>
                  )
                }
              />
            ) : null
          }
        />
      </div>
    </div>
  );
}

function CheckpointRow(props: {
  feito: boolean;
  rotulo: string;
  detalhe: string;
  acao?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-3 flex items-center justify-between gap-3 ${
        props.feito
          ? "border-emerald-200 bg-emerald-50/40"
          : "border-border bg-background"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {props.feito ? (
          <Check
            className="h-5 w-5 text-emerald-600 shrink-0"
            aria-label="Concluído"
          />
        ) : (
          <Square
            className="h-5 w-5 text-muted-foreground shrink-0"
            aria-label="Pendente"
          />
        )}
        <div className="min-w-0">
          <p className="font-medium">{props.rotulo}</p>
          <p className="truncate text-xs text-muted-foreground">
            {props.detalhe}
          </p>
        </div>
      </div>
      {props.acao}
    </div>
  );
}
