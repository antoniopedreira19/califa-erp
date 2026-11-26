"use client";

import * as React from "react";
import { Check, Upload } from "lucide-react";
import type { ResumoFolhaOrigem } from "@/lib/types";
import { ImportarFolhaModal } from "./importar-folha-modal";
import { ModalEnviarFolhaCLT } from "./modal-enviar-folha-clt";

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
  // estado 3: tem linhas mas nenhuma rascunho/pendente
  const tudoEnviado =
    !vazioTotal && !temRascunhoOuPendente;

  const podeSendBtn =
    podeEditar && clt.linhasRascunho + clt.linhasPendenteCorrecao > 0;

  // ── Estado 1: VAZIO ──────────────────────────────────────────────────────────
  if (vazioTotal) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Folha CLT · {competenciaLabel}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 pb-4 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma linha CLT importada ainda.
          </p>
          {podeEditar && (
            <ImportarFolhaModal
              ano={ano}
              mes={mes}
              triggerLabel={
                <>
                  <Upload className="h-3.5 w-3.5" />
                  Importar folha CLT
                </>
              }
            />
          )}
        </div>
      </div>
    );
  }

  // ── Cabeçalho compartilhado (estados 2 e 3) ──────────────────────────────────
  const cabecalho = (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Folha CLT · {mes.toString().padStart(2, "0")}/{ano}
      </p>
      <h3 className="mt-0.5 text-lg font-semibold">Folha CLT</h3>
      <p className="text-sm text-muted-foreground">
        {totalLinhas} {totalLinhas === 1 ? "linha" : "linhas"} ·{" "}
        {brl.format(clt.totalLiquido / 100)} líquido
      </p>
      <p className="text-xs text-muted-foreground">
        Já vem descontado da contabilidade
      </p>
    </div>
  );

  // ── Pílulas de status ─────────────────────────────────────────────────────────
  const pilulas = (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {clt.linhasRascunho > 0 && (
        <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {clt.linhasRascunho} rascunho
        </span>
      )}
      {clt.linhasPendenteCorrecao > 0 && (
        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
          {clt.linhasPendenteCorrecao} pendente de correção
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
  );

  // ── Estado 2: COM RASCUNHO OU PENDENTE ──────────────────────────────────────
  if (temRascunhoOuPendente) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          {cabecalho}
        </div>

        {pilulas}

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4 flex-wrap">
          {podeEditar && (
            <ImportarFolhaModal
              ano={ano}
              mes={mes}
              triggerLabel={
                <>
                  <Upload className="h-3.5 w-3.5" />
                  Reimportar arquivo
                </>
              }
            />
          )}
          <button
            type="button"
            onClick={() => setModalEnvioAberto(true)}
            disabled={!podeSendBtn}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Enviar CLT ao financeiro →
          </button>
        </div>

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

  // ── Estado 3: TUDO ENVIADO / APROVADO / PAGO ─────────────────────────────────
  // tudoEnviado === true aqui
  void tudoEnviado; // confirma que o caso foi pensado; sem uso runtime extra

  const temAprovadaOuPaga = clt.linhasAprovadas + clt.linhasPagas > 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        {cabecalho}
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <Check className="h-3.5 w-3.5" />
          Enviada ao financeiro
        </span>
      </div>

      {pilulas}

      {podeEditar && !temAprovadaOuPaga && (
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4">
          <ImportarFolhaModal
            ano={ano}
            mes={mes}
            triggerLabel={
              <>
                <Upload className="h-3.5 w-3.5" />
                Reimportar arquivo
              </>
            }
          />
        </div>
      )}
    </div>
  );
}
