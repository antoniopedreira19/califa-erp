"use client";

import * as React from "react";
import { FileText, Clock, CheckCircle2, Paperclip } from "lucide-react";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import {
  lancamentoEnviavel,
  type FolhaMin,
  type NfMin,
} from "@/lib/ferias/lancamento-enviavel";
import { DialogAnexarReciboContabil } from "./dialog-anexar-recibo-contabil";
import { DialogConfirmarEnvioFinanceiro } from "./dialog-confirmar-envio-financeiro";

type FolhaComValor = FolhaMin & {
  salario_base: string | number | null;
  data_pagamento_prevista: string | null;
};

type NfComMeta = {
  escopo_tipo: "ferias_usufruto" | "ferias_abono";
  arquivo_nome: string | null;
  uploaded_at: string | null;
};

type StatusLancamento =
  | "aguardando_gestor"
  | "pendente_aprovacao"
  | "aprovado"
  | "nf_anexada"
  | "enviado_financeiro"
  | "aguardando_financeiro"
  | "reprovado"
  | "cancelado"
  | "concluido";

const STATUSES_FECHADOS: StatusLancamento[] = [
  "enviado_financeiro",
  "concluido",
  "reprovado",
  "cancelado",
];

function rotuloDoc(
  origem: FolhaMin["origem"],
  tipo: FolhaMin["tipo_folha_ferias"],
): string {
  if (origem === "california") {
    return tipo === "abono" ? "NF de abono" : "NF de férias";
  }
  return tipo === "abono"
    ? "Recibo de abono California"
    : "Recibo da contabilidade";
}

function nomeArquivoRecibo(anexo_url: string | null): string | null {
  if (!anexo_url) return null;
  const partes = anexo_url.split("/");
  return partes[partes.length - 1] ?? null;
}

export function BlocoDocumentosLancamento({
  lancamentoId,
  statusLancamento,
  folhas,
  nfsPorEscopo,
  role,
}: {
  lancamentoId: string;
  statusLancamento: StatusLancamento;
  folhas: FolhaComValor[];
  nfsPorEscopo: NfComMeta[];
  role: string;
}) {
  const [folhaAnexando, setFolhaAnexando] = React.useState<FolhaComValor | null>(
    null,
  );
  const [confirmandoEnvio, setConfirmandoEnvio] = React.useState(false);

  const ehRh = role === "rh" || role === "administrador";
  const fechado = STATUSES_FECHADOS.includes(statusLancamento);

  const nfsMin: NfMin[] = nfsPorEscopo.map((n) => ({
    escopo_tipo: n.escopo_tipo,
    escopo_id: lancamentoId,
  }));
  const resultado = lancamentoEnviavel(lancamentoId, folhas, nfsMin);
  const totalFolhas = folhas.length;
  const folhasAnexadas = folhas.filter((f) => {
    if (f.origem === "contabilidade") return !!f.anexo_url;
    const escopo =
      f.tipo_folha_ferias === "abono" ? "ferias_abono" : "ferias_usufruto";
    return nfsPorEscopo.some((n) => n.escopo_tipo === escopo);
  }).length;

  const folhasRascunho = folhas.filter((f) => f.status === "rascunho");
  const valorTotalRascunho = folhasRascunho.reduce(
    (acc, f) => acc + Number(f.salario_base ?? 0),
    0,
  );
  const datasPrevistas = folhasRascunho
    .map((f) => f.data_pagamento_prevista)
    .filter((v): v is string => !!v)
    .sort();
  const dataPagamentoDefault = datasPrevistas[0] ?? "";

  const botaoHabilitado = resultado.ok && !fechado && folhasRascunho.length > 0;
  const tooltipDesabilitado = !botaoHabilitado
    ? fechado
      ? "Lançamento já finalizado."
      : !resultado.ok
        ? "Faltam documentos: " + resultado.falta.join(", ") + "."
        : "Sem folhas em rascunho pra enviar."
    : undefined;

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Documentos
        </h4>
        <span className="ml-auto text-[11px] font-medium text-muted-foreground">
          {folhasAnexadas}/{totalFolhas} anexado{totalFolhas === 1 ? "" : "s"}
        </span>
      </div>

      <ul className="space-y-1.5">
        {folhas.map((f) => {
          const label = rotuloDoc(f.origem, f.tipo_folha_ferias);
          const escopoEsperado =
            f.tipo_folha_ferias === "abono"
              ? "ferias_abono"
              : "ferias_usufruto";
          const nfAnexada = nfsPorEscopo.find(
            (n) => n.escopo_tipo === escopoEsperado,
          );
          const anexado =
            f.origem === "contabilidade" ? !!f.anexo_url : !!nfAnexada;
          const nomeArquivo =
            f.origem === "contabilidade"
              ? nomeArquivoRecibo(f.anexo_url)
              : (nfAnexada?.arquivo_nome ?? null);
          const uploadedAt =
            f.origem === "california" ? (nfAnexada?.uploaded_at ?? null) : null;

          return (
            <li
              key={f.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                anexado
                  ? "border-sky-200 bg-sky-50/50"
                  : "border-dashed border-amber-300 bg-amber-50/40"
              }`}
            >
              {anexado ? (
                <CheckCircle2 className="h-4 w-4 text-sky-700 shrink-0" />
              ) : (
                <Clock className="h-4 w-4 text-amber-700 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={`text-xs font-semibold ${anexado ? "text-sky-900" : "text-amber-900"}`}
                >
                  {label}
                </p>
                {anexado ? (
                  <p className="text-[11px] text-sky-800/70 truncate">
                    {nomeArquivo ?? "Anexado"}
                    {uploadedAt ? ` · ${formatDiaBr(uploadedAt)}` : ""}
                  </p>
                ) : (
                  <p className="text-[11px] text-amber-800/80">
                    {f.origem === "california"
                      ? "Aguardando colaborador anexar no perfil."
                      : ehRh
                        ? "Aguardando o RH anexar o recibo da contabilidade."
                        : "Aguardando RH anexar."}
                  </p>
                )}
              </div>
              {!anexado && f.origem === "contabilidade" && ehRh && (
                <button
                  type="button"
                  onClick={() => setFolhaAnexando(f)}
                  className="inline-flex items-center gap-1 rounded-lg border border-california-red bg-white px-2.5 py-1 text-xs font-medium text-california-red hover:bg-california-red/5 transition-colors"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Anexar
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {ehRh && !fechado && folhasRascunho.length > 0 && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={() => setConfirmandoEnvio(true)}
            disabled={!botaoHabilitado}
            title={tooltipDesabilitado}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-3 py-1.5 text-xs font-medium text-white hover:bg-california-red/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            Enviar ao financeiro
          </button>
        </div>
      )}

      {folhaAnexando && (
        <DialogAnexarReciboContabil
          aberto={!!folhaAnexando}
          folhaId={folhaAnexando.id}
          valorBasePreview={
            folhaAnexando.salario_base
              ? Number(folhaAnexando.salario_base)
              : null
          }
          rotulo={rotuloDoc(
            folhaAnexando.origem,
            folhaAnexando.tipo_folha_ferias,
          )}
          onFechar={() => setFolhaAnexando(null)}
        />
      )}

      {confirmandoEnvio && (
        <DialogConfirmarEnvioFinanceiro
          aberto={confirmandoEnvio}
          lancamentoId={lancamentoId}
          totalFolhasRascunho={folhasRascunho.length}
          valorTotal={valorTotalRascunho}
          dataPagamentoDefault={dataPagamentoDefault}
          onFechar={() => setConfirmandoEnvio(false)}
        />
      )}
    </div>
  );
}
