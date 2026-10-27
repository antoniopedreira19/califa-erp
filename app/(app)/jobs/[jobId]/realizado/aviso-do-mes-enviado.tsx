"use client";

/** O aviso do mês já enviado para faturamento, na errata do job mensal
 *  (Fee e Always On).
 *
 *  Até 27/10/2026 uma faixa fixa acima da planilha dizia que o mês enviado
 *  travava a errata e o consumo de save. O Tiago pediu que ela saísse e que
 *  o aviso aparecesse só na tentativa: quem clica numa linha desse mês com
 *  a errata ligada vê por que ela não abre. O consumo de save já avisava no
 *  próprio pop-up (`save-dialog`, motivo "mes"). */

import { Lock, X } from "lucide-react";
import { nomeDoMes } from "@/lib/calculos/meses-trimestre";

export function AvisoDoMesEnviado({
  mes,
  onFechar,
}: {
  /** `YYYY-MM-01`. */
  mes: string;
  onFechar: () => void;
}) {
  const nome = nomeDoMes(mes);
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800"
    >
      <Lock className="mt-0.5 h-3.5 w-3.5 flex-none" />
      <span className="flex-1">
        {nome.charAt(0).toUpperCase() + nome.slice(1)} já foi enviado para
        faturamento: as linhas desse mês não mudam pela errata.
      </span>
      <button
        type="button"
        onClick={onFechar}
        aria-label="Fechar aviso"
        className="flex-none rounded p-0.5 text-amber-700 transition-colors hover:bg-amber-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
