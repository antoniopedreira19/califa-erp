"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  PlayCircle,
  RefreshCw,
  Send,
  Zap,
} from "lucide-react";
import type { ResumoCardsFolha } from "@/lib/types";
import { BotaoGerarFolhaPj } from "./botao-gerar-folha-pj";
import { BotaoAtualizarFolhaPj } from "./botao-atualizar-folha-pj";
import { BotaoAplicarBeneficiosPJ } from "./botao-aplicar-beneficios-pj";
import { BotaoDesaplicarBeneficios } from "./botao-desaplicar-beneficios";
import { ModalEnviarFolhaPJ } from "./modal-enviar-folha-pj";
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

  const vazioTotal = totalLinhas === 0;
  const temRascunhoOuPendente = linhasRascunhoOuPendente > 0;
  const tudoEnviado = !vazioTotal && !temRascunhoOuPendente;

  // Bruto = líquido + desconto (quando snapshot não aplicado, desconto=0)
  const totalBruto = pj.totalLiquido + pj.totalDescontoBeneficios;

  const catalogoBloqueia = catalogoIncompleto !== null;

  // ── Estado de cada passo da timeline ─────────────────────────────────────────
  // Passo 1: Gerar/Atualizar PJ
  const step1State: "done" | "current" | "locked" = vazioTotal
    ? "current"
    : "done";

  // Passo 2: Aplicar benefícios
  const step2State: "done" | "current" | "locked" = vazioTotal
    ? "locked"
    : beneficios.aplicado
      ? "done"
      : catalogoBloqueia
        ? "locked"
        : "current";

  // Passo 3: Enviar ao financeiro
  const step3State: "done" | "current" | "locked" = tudoEnviado
    ? "done"
    : !beneficios.aplicado ||
        !temRascunhoOuPendente ||
        catalogoBloqueia ||
        vazioTotal
      ? "locked"
      : "current";

  // Tooltip explicativo quando Enviar está locked
  const tooltipEnviar = catalogoBloqueia
    ? "Corrija o catálogo de benefícios antes de enviar."
    : !beneficios.aplicado
      ? "Aplique os benefícios antes de enviar."
      : !temRascunhoOuPendente
        ? "Nenhuma linha pendente de envio."
        : undefined;

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
  const alertaCatalogo = catalogoBloqueia ? (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>
        Catálogo de benefícios incompleto: {catalogoIncompleto}. Edite em{" "}
        <Link
          href="/rh/beneficios"
          prefetch={false}
          className="underline hover:text-red-900 font-medium"
        >
          /rh/beneficios
        </Link>{" "}
        → Catálogo antes de enviar.
      </span>
    </div>
  ) : null;

  // ── Pílulas de status ─────────────────────────────────────────────────────────
  const pilulas = !vazioTotal ? (
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
  ) : null;

  // ── Resumo (subtítulo) ───────────────────────────────────────────────────────
  const subtitulo = vazioTotal ? (
    <p className="mt-1 text-sm text-muted-foreground">
      Nenhuma linha PJ gerada ainda.
    </p>
  ) : beneficios.aplicado ? (
    <div className="mt-1 space-y-0.5">
      <p className="text-sm text-muted-foreground">
        {totalLinhas} {totalLinhas === 1 ? "linha" : "linhas"} ·{" "}
        {brl.format(totalBruto)} bruto −{" "}
        {brl.format(pj.totalDescontoBeneficios)} benefícios ={" "}
        {brl.format(pj.totalLiquido)} líquido
      </p>
      <p className="text-xs font-medium text-emerald-700">
        ✓ Benefícios aplicados · {pj.colaboradoresComDesconto}{" "}
        {pj.colaboradoresComDesconto === 1 ? "colaborador" : "colaboradores"}{" "}
        com desconto
      </p>
    </div>
  ) : (
    <div className="mt-1 space-y-0.5">
      <p className="text-sm text-muted-foreground">
        {totalLinhas} {totalLinhas === 1 ? "linha" : "linhas"} ·{" "}
        {brl.format(totalBruto)} bruto
      </p>
      {pj.previewDescontoBeneficios !== null &&
        pj.previewQtdVinculos !== null &&
        pj.previewQtdVinculos > 0 &&
        pj.previewDescontoBeneficios > 0 && (
          <p className="text-xs text-muted-foreground">
            Benefícios previstos: −{brl.format(pj.previewDescontoBeneficios)}
          </p>
        )}
      {pj.previewQtdVinculos !== null && pj.previewQtdVinculos === 0 && (
        <p className="text-xs text-muted-foreground">
          Sem vínculos de benefícios nesta competência.
        </p>
      )}
    </div>
  );

  // ── Timeline de passos ───────────────────────────────────────────────────────
  const timeline = (
    <div className="mt-4 border-t border-border pt-4">
      {/* Ajuste do empty state: timeline oculto se usuário não pode editar e card está vazio */}
      {!podeEditar && vazioTotal ? null : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            {/* Passo 1: Gerar (vazio) OR Atualizar (gerado) */}
            {vazioTotal ? (
              <BotaoGerarFolhaPj
                ano={ano}
                mes={mes}
                renderTrigger={({ onClick, pending, disabled }) => (
                  <StepButton
                    step={1}
                    label="Gerar folha"
                    state={step1State}
                    icon={PlayCircle}
                    onClick={onClick}
                    pending={pending}
                    disabled={disabled || !podeEditar}
                  />
                )}
              />
            ) : (
              <BotaoAtualizarFolhaPj
                ano={ano}
                mes={mes}
                renderTrigger={({ onClick, pending, disabled }) => (
                  <StepButton
                    step={1}
                    label="Atualizar folha"
                    state={step1State}
                    icon={RefreshCw}
                    onClick={onClick}
                    pending={pending}
                    disabled={disabled || !podeEditar}
                    title="Resincroniza salários das linhas em rascunho com o vigente."
                  />
                )}
              />
            )}

            <StepArrow />

            {/* Passo 2: Aplicar benefícios */}
            <BotaoAplicarBeneficiosPJ
              ano={ano}
              mes={mes}
              previewDescontoBeneficios={pj.previewDescontoBeneficios}
              previewQtdVinculos={pj.previewQtdVinculos}
              disabled={
                step2State !== "current" || !podeEditar
              }
              renderTrigger={({ onClick, pending, disabled }) => (
                <StepButton
                  step={2}
                  label="Aplicar benefícios"
                  state={step2State}
                  icon={Zap}
                  onClick={onClick}
                  pending={pending}
                  disabled={disabled || !podeEditar}
                  title={
                    step2State === "locked" && catalogoBloqueia
                      ? "Corrija o catálogo de benefícios primeiro."
                      : step2State === "locked" && vazioTotal
                        ? "Gere a folha PJ antes de aplicar benefícios."
                        : undefined
                  }
                />
              )}
            />

            <StepArrow />

            {/* Passo 3: Enviar ao financeiro */}
            <StepButton
              step={3}
              label="Enviar ao financeiro"
              state={step3State}
              icon={Send}
              onClick={() => setModalEnvioAberto(true)}
              disabled={step3State !== "current" || !podeEditar}
              title={tooltipEnviar}
            />
          </div>

          {mostrarDesaplicar && (
            <div className="mt-3 flex justify-end">
              <BotaoDesaplicarBeneficios
                fechamentoId={beneficios.fechamentoId!}
              />
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      {alertaCatalogo && <div className="mb-4">{alertaCatalogo}</div>}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            FOLHA PJ · {competenciaLabel}
          </p>
          <h3 className="mt-0.5 text-lg font-semibold">Folha PJ</h3>
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
