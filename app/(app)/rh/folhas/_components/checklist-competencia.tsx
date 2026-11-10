"use client";

import * as React from "react";
import { Check, Square, Upload, Send } from "lucide-react";
import { ImportarFolhaModal } from "./importar-folha-modal";
import { BotaoGerarFolhaPj } from "./botao-gerar-folha-pj";
import { BotaoAplicarBeneficios } from "./botao-aplicar-beneficios";
import { BotaoDesaplicarBeneficios } from "./botao-desaplicar-beneficios";
import { ModalEnviarFinanceiro } from "./modal-enviar-financeiro";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export interface ChecklistBeneficiosProp {
  aplicado: boolean;
  fechamentoId: string | null;
  qtdVinculos: number;
  totalEmpresa: number;
  totalColaborador: number;
  totalIntegral: number;
  avulsaPaga: boolean;
}

export interface ChecklistCompetenciaProps {
  ano: number;
  mes: number;
  pj: { linhas: number; total: number };
  clt: { linhas: number; total: number };
  beneficios: ChecklistBeneficiosProp;
  rascunhosAEnviar: number;
  podeEditar: boolean;
}

export function ChecklistCompetencia(props: ChecklistCompetenciaProps) {
  const [modalAberto, setModalAberto] = React.useState(false);
  const [sucesso, setSucesso] = React.useState<string | null>(null);

  const temPj = props.pj.linhas > 0;
  const temClt = props.clt.linhas > 0;
  const temBenef = props.beneficios.aplicado;
  const podeEnviar = temPj && temClt && temBenef && props.rascunhosAEnviar > 0;

  function handleEnviar() {
    if (!podeEnviar) return;
    setSucesso(null);
    setModalAberto(true);
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
            disabled={!podeEnviar}
            title={
              !temPj
                ? "Gere a folha PJ antes."
                : !temClt
                  ? "Importe a folha CLT antes."
                  : !temBenef
                    ? "Aplique os descontos de benefícios antes de enviar."
                    : props.rascunhosAEnviar === 0
                      ? "Nenhum rascunho para enviar."
                      : undefined
            }
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <Send className="h-4 w-4" />
            Enviar ao financeiro
          </button>
        )}
      </div>

      <ModalEnviarFinanceiro
        open={modalAberto}
        onOpenChange={setModalAberto}
        ano={props.ano}
        mes={props.mes}
        onEnviado={(n) =>
          setSucesso(
            `${n} linha${n === 1 ? "" : "s"} enviada${n === 1 ? "" : "s"} ao financeiro.`,
          )
        }
      />

      {sucesso && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {sucesso}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <CheckpointRow
          feito={temPj}
          rotulo="PJ gerada"
          detalhe={
            temPj
              ? `${props.pj.linhas} linha${props.pj.linhas === 1 ? "" : "s"} · ${brl.format(props.pj.total)}`
              : "Nenhuma linha gerada ainda"
          }
          acao={
            !temPj && props.podeEditar ? (
              <BotaoGerarFolhaPj ano={props.ano} mes={props.mes} />
            ) : null
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
        <CheckpointRow
          feito={temBenef}
          rotulo="Benefícios aplicados"
          detalhe={
            temBenef
              ? `${props.beneficios.qtdVinculos} vínculo${props.beneficios.qtdVinculos === 1 ? "" : "s"} · ${brl.format(props.beneficios.totalIntegral)}`
              : "Nenhuma competência fechada ainda"
          }
          acao={
            props.podeEditar && temPj && temClt && !temBenef ? (
              <BotaoAplicarBeneficios ano={props.ano} mes={props.mes} />
            ) : props.podeEditar &&
              temBenef &&
              !props.beneficios.avulsaPaga &&
              props.beneficios.fechamentoId ? (
              <BotaoDesaplicarBeneficios
                fechamentoId={props.beneficios.fechamentoId}
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
