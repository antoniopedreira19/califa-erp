"use client";

import * as React from "react";
import { Check, Send, Upload } from "lucide-react";
import type { ResumoFolhaOrigem } from "@/lib/types";
import { ImportarFolhaModal } from "./importar-folha-modal";
import { ModalEnviarFolhaCLT } from "./modal-enviar-folha-clt";
import { StepArrow, StepButton } from "./step-button";

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

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export interface CardFolhaCLTProps {
  ano: number;
  mes: number;
  clt: ResumoFolhaOrigem;
  podeEditar: boolean;
}

export function CardFolhaCLT(props: CardFolhaCLTProps): JSX.Element {
  const { ano, mes, clt, podeEditar } = props;
  const [modalEnvioAberto, setModalEnvioAberto] = React.useState(false);

  const competenciaLabel = `${NOMES_MES[mes - 1]}/${ano}`;

  const totalLinhas =
    clt.linhasRascunho +
    clt.linhasPendenteCorrecao +
    clt.linhasEnviadas +
    clt.linhasAprovadas +
    clt.linhasPagas;

  const vazioTotal = totalLinhas === 0;
  const temRascunhoOuPendente =
    clt.linhasRascunho + clt.linhasPendenteCorrecao > 0;
  const tudoEnviado = !vazioTotal && !temRascunhoOuPendente;

  // ── Estado de cada passo da timeline ─────────────────────────────────────────
  // Passo 1: Importar/Reimportar
  const step1State: "done" | "current" | "locked" = vazioTotal
    ? "current"
    : "done";

  // Passo 2: Enviar
  const step2State: "done" | "current" | "locked" = tudoEnviado
    ? "done"
    : temRascunhoOuPendente
      ? "current"
      : "locked";

  // ── Subtítulo ────────────────────────────────────────────────────────────────
  const subtitulo = vazioTotal ? (
    <p className="mt-1 text-sm text-muted-foreground">
      Nenhuma linha CLT importada ainda.
    </p>
  ) : (
    <>
      <p className="mt-1 text-sm text-muted-foreground">
        {totalLinhas} {totalLinhas === 1 ? "linha" : "linhas"} ·{" "}
        {brl.format(clt.totalLiquido)} líquido
      </p>
      <p className="text-xs text-muted-foreground">
        Já vem descontado da contabilidade
      </p>
    </>
  );

  // ── Pílulas de status ─────────────────────────────────────────────────────────
  const pilulas = !vazioTotal ? (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {clt.linhasRascunho > 0 && (
        <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {clt.linhasRascunho}{" "}
          {clt.linhasRascunho === 1 ? "rascunho" : "rascunhos"}
        </span>
      )}
      {clt.linhasPendenteCorrecao > 0 && (
        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
          {clt.linhasPendenteCorrecao}{" "}
          {clt.linhasPendenteCorrecao === 1
            ? "pendente de correção"
            : "pendentes de correção"}
        </span>
      )}
      {clt.linhasEnviadas > 0 && (
        <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">
          {clt.linhasEnviadas}{" "}
          {clt.linhasEnviadas === 1 ? "enviada" : "enviadas"}
        </span>
      )}
      {clt.linhasAprovadas > 0 && (
        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
          {clt.linhasAprovadas}{" "}
          {clt.linhasAprovadas === 1 ? "aprovada" : "aprovadas"}
        </span>
      )}
      {clt.linhasPagas > 0 && (
        <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
          {clt.linhasPagas} {clt.linhasPagas === 1 ? "paga" : "pagas"}
        </span>
      )}
    </div>
  ) : null;

  const temAprovadaOuPaga = clt.linhasAprovadas + clt.linhasPagas > 0;

  // ── Timeline de passos ───────────────────────────────────────────────────────
  // Em CLT, se linhas já estão aprovadas/pagas, não deixa reimportar.
  const podeReimportar = !temAprovadaOuPaga;

  const timeline = podeEditar ? (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        {/* Passo 1: Importar / Reimportar */}
        {podeReimportar ? (
          <ImportarFolhaModal
            ano={ano}
            mes={mes}
            renderTrigger={() => (
              <StepButton
                step={1}
                label={vazioTotal ? "Importar folha" : "Reimportar folha"}
                state={step1State}
                icon={Upload}
              />
            )}
          />
        ) : (
          <StepButton
            step={1}
            label="Folha importada"
            state="done"
            icon={Upload}
            disabled
            title="Linhas CLT já aprovadas; reimportar não é permitido."
          />
        )}

        <StepArrow />

        {/* Passo 2: Enviar */}
        <StepButton
          step={2}
          label="Enviar ao financeiro"
          state={step2State}
          icon={Send}
          onClick={() => setModalEnvioAberto(true)}
          disabled={step2State !== "current"}
          title={
            step2State === "locked" && vazioTotal
              ? "Importe a folha CLT antes de enviar."
              : step2State === "locked" && !temRascunhoOuPendente
                ? "Nenhuma linha pendente de envio."
                : undefined
          }
        />
      </div>
    </div>
  ) : null;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            FOLHA CLT · {competenciaLabel}
          </p>
          <h3 className="mt-0.5 text-lg font-semibold">Folha CLT</h3>
        </div>
        {tudoEnviado && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <Check className="h-3.5 w-3.5" />
            Enviada ao financeiro
          </span>
        )}
      </div>

      {subtitulo}

      {pilulas}

      {timeline}

      <ModalEnviarFolhaCLT
        open={modalEnvioAberto}
        onOpenChange={setModalEnvioAberto}
        ano={ano}
        mes={mes}
        linhasRascunho={clt.linhasRascunho}
        linhasPendenteCorrecao={clt.linhasPendenteCorrecao}
      />
    </div>
  );
}
