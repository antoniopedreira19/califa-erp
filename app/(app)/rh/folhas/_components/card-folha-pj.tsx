"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Check } from "lucide-react";
import type { ResumoCardsFolha } from "@/lib/types";
import { BotaoGerarFolhaPj } from "./botao-gerar-folha-pj";
import { BotaoAtualizarFolhaPj } from "./botao-atualizar-folha-pj";
import { BotaoDesaplicarBeneficios } from "./botao-desaplicar-beneficios";
import { ModalEnviarFolhaPJ } from "./modal-enviar-folha-pj";

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

export interface CardFolhaPJProps {
  ano: number;
  mes: number;
  pj: ResumoCardsFolha["pj"];
  beneficios: ResumoCardsFolha["beneficios"];
  catalogoIncompleto: string | null;
  podeEditar: boolean;
}

export function CardFolhaPJ(props: CardFolhaPJProps): JSX.Element {
  const { ano, mes, pj, beneficios, catalogoIncompleto, podeEditar } = props;
  const [modalEnvioAberto, setModalEnvioAberto] = React.useState(false);

  const competenciaLabel = `${NOMES_MES[mes - 1]}/${ano}`;

  const totalLinhas =
    pj.linhasRascunho +
    pj.linhasPendenteCorrecao +
    pj.linhasEnviadas +
    pj.linhasAprovadas +
    pj.linhasPagas;

  const linhasRascunhoOuPendente = pj.linhasRascunho + pj.linhasPendenteCorrecao;
  const linhasForaRascunho = pj.linhasEnviadas + pj.linhasAprovadas + pj.linhasPagas;

  const vazioTotal = totalLinhas === 0;
  const temRascunhoOuPendente = linhasRascunhoOuPendente > 0;
  // estado 4: tem linhas mas nenhuma rascunho/pendente
  const tudoEnviado = !vazioTotal && !temRascunhoOuPendente;

  // Bruto = líquido + desconto (quando snapshot não aplicado, desconto=0 e líquido=bruto)
  const totalBruto = pj.totalLiquido + pj.totalDescontoBeneficios;

  const podeSendBtn =
    podeEditar &&
    linhasRascunhoOuPendente > 0 &&
    catalogoIncompleto === null;

  // Condições para link "Desaplicar": snapshot aplicado, sem avulsa paga,
  // e TODAS as linhas ainda em rascunho (nenhuma saiu de rascunho).
  const mostrarDesaplicar =
    beneficios.aplicado &&
    !beneficios.avulsaPaga &&
    pj.linhasEnviadas === 0 &&
    pj.linhasAprovadas === 0 &&
    pj.linhasPagas === 0 &&
    pj.linhasPendenteCorrecao === 0 &&
    podeEditar &&
    beneficios.fechamentoId !== null;

  // ── Alerta de catálogo incompleto ─────────────────────────────────────────
  const alertaCatalogo = catalogoIncompleto !== null ? (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>
        Catálogo de benefícios incompleto: {catalogoIncompleto}. Edite em{" "}
        <Link
          href="/rh/beneficios"
          prefetch={false}
          className="underline hover:text-red-900 font-medium"
        >
          /rh/benefícios
        </Link>{" "}
        → Catálogo antes de enviar.
      </span>
    </div>
  ) : null;

  // ── Estado 1: VAZIO ──────────────────────────────────────────────────────────
  if (vazioTotal) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          FOLHA PJ · {competenciaLabel}
        </p>
        {alertaCatalogo && <div className="mt-3">{alertaCatalogo}</div>}
        <div className="mt-8 flex flex-col items-center justify-center gap-4 pb-4 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma linha PJ gerada ainda.
          </p>
          {podeEditar && (
            <BotaoGerarFolhaPj ano={ano} mes={mes} />
          )}
        </div>
      </div>
    );
  }

  // ── Cabeçalho compartilhado (estados 2, 3 e 4) ───────────────────────────────
  const cabecalhoBase = (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        FOLHA PJ · {competenciaLabel}
      </p>
      <h3 className="mt-0.5 text-lg font-semibold">Folha PJ</h3>
    </div>
  );

  // ── Pílulas de status ─────────────────────────────────────────────────────────
  const pilulas = (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {pj.linhasRascunho > 0 && (
        <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {pj.linhasRascunho}{" "}
          {pj.linhasRascunho === 1 ? "rascunho" : "rascunhos"}
        </span>
      )}
      {pj.linhasPendenteCorrecao > 0 && (
        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
          {pj.linhasPendenteCorrecao}{" "}
          {pj.linhasPendenteCorrecao === 1
            ? "pendente de correção"
            : "pendentes de correção"}
        </span>
      )}
      {pj.linhasEnviadas > 0 && (
        <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">
          {pj.linhasEnviadas}{" "}
          {pj.linhasEnviadas === 1 ? "enviada" : "enviadas"}
        </span>
      )}
      {pj.linhasAprovadas > 0 && (
        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
          {pj.linhasAprovadas}{" "}
          {pj.linhasAprovadas === 1 ? "aprovada" : "aprovadas"}
        </span>
      )}
      {pj.linhasPagas > 0 && (
        <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
          {pj.linhasPagas}{" "}
          {pj.linhasPagas === 1 ? "paga" : "pagas"}
        </span>
      )}
    </div>
  );

  // ── Estado 4: TUDO ENVIADO / APROVADO / PAGO ─────────────────────────────────
  if (tudoEnviado) {
    void linhasForaRascunho; // confirma que o caso foi pensado

    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        {alertaCatalogo && <div className="mb-4">{alertaCatalogo}</div>}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          {cabecalhoBase}
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <Check className="h-3.5 w-3.5" />
            Enviada ao financeiro
          </span>
        </div>

        <div className="mt-1">
          {beneficios.aplicado ? (
            <>
              <p className="text-sm text-muted-foreground">
                {totalLinhas} {totalLinhas === 1 ? "linha" : "linhas"} ·{" "}
                {brl.format(totalBruto / 100)} bruto −{" "}
                {brl.format(pj.totalDescontoBeneficios / 100)} benefícios ={" "}
                {brl.format(pj.totalLiquido / 100)} líquido
              </p>
              <p className="mt-0.5 text-xs font-medium text-emerald-700">
                ✓ Benefícios aplicados · {beneficios.qtdVinculos}{" "}
                {beneficios.qtdVinculos === 1 ? "vínculo" : "vínculos"} ·{" "}
                {brl.format(beneficios.totalIntegral / 100)}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {totalLinhas} {totalLinhas === 1 ? "linha" : "linhas"} ·{" "}
              {brl.format(pj.totalLiquido / 100)} líquido
            </p>
          )}
        </div>

        {pilulas}
      </div>
    );
  }

  // ── Estados 2 e 3: TEM RASCUNHO OU PENDENTE ──────────────────────────────────
  // beneficios.aplicado distingue estado 2 (false) de estado 3 (true)

  const subtitulo = beneficios.aplicado ? (
    // Estado 3: snapshot aplicado — mostrar bruto − desconto = líquido
    <div className="mt-1 space-y-0.5">
      <p className="text-sm text-muted-foreground">
        {totalLinhas} {totalLinhas === 1 ? "linha" : "linhas"} ·{" "}
        {brl.format(totalBruto / 100)} bruto −{" "}
        {brl.format(pj.totalDescontoBeneficios / 100)} benefícios ={" "}
        {brl.format(pj.totalLiquido / 100)} líquido
      </p>
      <p className="text-xs font-medium text-emerald-700">
        ✓ Benefícios aplicados · {beneficios.qtdVinculos}{" "}
        {beneficios.qtdVinculos === 1 ? "vínculo" : "vínculos"} ·{" "}
        {brl.format(beneficios.totalIntegral / 100)}
      </p>
      {beneficios.avulsasGeradas && (
        <p className="text-xs text-muted-foreground">
          {brl.format(beneficios.totalIntegral / 100)} em avulsas de operadora
        </p>
      )}
    </div>
  ) : (
    // Estado 2: snapshot não aplicado — mostrar bruto + preview se houver
    <div className="mt-1 space-y-0.5">
      <p className="text-sm text-muted-foreground">
        {totalLinhas} {totalLinhas === 1 ? "linha" : "linhas"} ·{" "}
        {brl.format(totalBruto / 100)} bruto
      </p>
      {/* Preview só aparece quando há vínculos e valor > 0 e não é null (catálogo incompleto) */}
      {pj.previewDescontoBeneficios !== null &&
        pj.previewQtdVinculos !== null &&
        pj.previewQtdVinculos > 0 &&
        pj.previewDescontoBeneficios > 0 && (
          <p className="text-xs text-muted-foreground">
            Benefícios previstos: −{brl.format(pj.previewDescontoBeneficios / 100)}{" "}
            (aplicados no Enviar)
          </p>
        )}
      {pj.previewQtdVinculos !== null && pj.previewQtdVinculos === 0 && (
        <p className="text-xs text-muted-foreground">
          Sem vínculos de benefícios nesta competência.
        </p>
      )}
    </div>
  );

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      {alertaCatalogo && <div className="mb-4">{alertaCatalogo}</div>}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        {cabecalhoBase}
      </div>

      {subtitulo}

      {pilulas}

      <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <BotaoAtualizarFolhaPj ano={ano} mes={mes} />
          <button
            type="button"
            onClick={() => setModalEnvioAberto(true)}
            disabled={!podeSendBtn}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Enviar PJ ao financeiro →
          </button>
        </div>

        {mostrarDesaplicar && (
          <div className="flex justify-end">
            <BotaoDesaplicarBeneficios fechamentoId={beneficios.fechamentoId!} />
          </div>
        )}
      </div>

      <ModalEnviarFolhaPJ
        open={modalEnvioAberto}
        onOpenChange={setModalEnvioAberto}
        ano={ano}
        mes={mes}
        linhasRascunho={pj.linhasRascunho}
        linhasPendenteCorrecao={pj.linhasPendenteCorrecao}
        beneficiosAplicado={beneficios.aplicado}
      />
    </div>
  );
}
