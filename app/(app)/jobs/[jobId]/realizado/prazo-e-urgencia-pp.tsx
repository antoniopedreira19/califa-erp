"use client";

/**
 * As peças da decisão 077 que os dois formulários da produção dividem — o
 * de gerar/editar PP e o de corrigir a rejeitada: o calendário que só
 * acende janelas de pagamento, o aviso da PP anterior à regra e o bloco de
 * pagamento urgente. Um lugar só, para as duas telas não divergirem.
 */

import * as React from "react";
import { format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ehJanelaDePagamento } from "@/lib/calculos/janelas-pagamento";
import { PP_URGENTE_JUSTIFICATIVA_MIN } from "@/lib/types";

/**
 * Predicado do `dateDisabled` do calendário: apaga o passado e todo dia
 * que não é janela. A data já gravada (`original`) continua clicável — é
 * a PP anterior à regra, que pode seguir com ela (pergunta 6a).
 */
export function diaForaDaJanela(hojeIso: string, original?: string | null) {
  return (date: Date) => {
    const iso = format(date, "yyyy-MM-dd");
    if (original && iso === original.slice(0, 10)) return false;
    return iso < hojeIso || !ehJanelaDePagamento(iso);
  };
}

/** Aparece só quando o prazo é o gravado e ele está fora das janelas. */
export function AvisoPrazoForaDaJanela({
  prazo,
  original,
}: {
  prazo: string;
  original: string | null;
}) {
  if (!prazo || !original || prazo !== original.slice(0, 10)) return null;
  if (ehJanelaDePagamento(prazo)) return null;
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-800">
      <AlertTriangle className="mt-0.5 h-3 w-3 flex-none" />
      Prazo fora das janelas de pagamento — esta PP é anterior à regra.
      Salvar sem mexer mantém a data; para trocar, só os dias 08 e 20.
    </p>
  );
}

export function UrgenciaPPField({
  urgente,
  justificativa,
  onUrgenteChange,
  onJustificativaChange,
  destacarFalta,
  disabled,
}: {
  urgente: boolean;
  justificativa: string;
  onUrgenteChange: (urgente: boolean) => void;
  onJustificativaChange: (texto: string) => void;
  /** O envio foi tentado com a justificativa curta: borda e contador em vermelho. */
  destacarFalta: boolean;
  disabled?: boolean;
}) {
  const caracteres = justificativa.trim().length;
  const curta = caracteres < PP_URGENTE_JUSTIFICATIVA_MIN;
  const emFalta = destacarFalta && curta;
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 transition-colors",
        urgente ? "border-california-red/40 bg-california-red/[0.04]" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">Pagamento urgente</p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Avisa o financeiro que o pagamento precisa ser adiantado. O prazo
            continua numa janela — quem antecipa é o financeiro, na aprovação.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={urgente}
          aria-label="Pagamento urgente"
          onClick={() => onUrgenteChange(!urgente)}
          disabled={disabled}
          className={cn(
            "relative inline-flex h-5 w-9 flex-none items-center rounded-full border-2 border-transparent transition-colors disabled:opacity-50",
            urgente ? "bg-california-red" : "bg-muted-foreground/30",
          )}
        >
          <span
            className={cn(
              "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
              urgente ? "translate-x-4" : "translate-x-0",
            )}
          />
        </button>
      </div>

      {urgente && (
        <div className="mt-2.5">
          <label htmlFor="pp-urgente-justificativa" className="text-xs font-medium">
            Justificativa *
          </label>
          <textarea
            id="pp-urgente-justificativa"
            value={justificativa}
            onChange={(e) => onJustificativaChange(e.target.value)}
            maxLength={1000}
            rows={2}
            disabled={disabled}
            placeholder="Por que este pagamento precisa ser adiantado?"
            className={cn(
              "mt-1 w-full rounded border bg-white p-2 text-sm",
              emFalta ? "border-california-red" : "border-border",
            )}
          />
          <p
            className={cn(
              "text-[11px]",
              emFalta ? "text-california-red" : "text-muted-foreground",
            )}
          >
            {caracteres} {caracteres === 1 ? "caractere" : "caracteres"} · mínimo{" "}
            {PP_URGENTE_JUSTIFICATIVA_MIN}
          </p>
        </div>
      )}
    </div>
  );
}
