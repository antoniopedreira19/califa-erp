"use client";

/** Os meses que a planilha de Fee e Always On vai ter, abaixo das datas do
 *  formulário do orçamento (Tiago, 27/10/2026; protótipo "Os três meses do
 *  trimestre").
 *
 *  O Fim previsto já vem no fim do trimestre; aqui o GP vê os meses que
 *  nascem e pode tirar o último pelo ×, o mesmo do campo de data, e o fim
 *  volta ao último dia do mês anterior. O primeiro mês não tem ×: ele vem
 *  do Início previsto. O do meio não sai sozinho, porque o período é
 *  contínuo. O mês do trimestre que ficou de fora aparece num aviso. */

import { CalendarDays, X } from "lucide-react";
import {
  erroDoPeriodoMensal,
  mesesDoPeriodo,
  mesesForaDoPeriodo,
  nomeDoMes,
  rotuloMesCurto,
  rotuloTrimestre,
  trimestreDe,
  ultimoDiaDoMes,
} from "@/lib/calculos/meses-trimestre";

function juntar(nomes: string[]): string {
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

export function MesesDoPeriodo({
  inicio,
  fim,
  onFim,
}: {
  inicio: string;
  fim: string;
  /** O novo Fim previsto, quando o GP tira o último mês. */
  onFim: (fim: string) => void;
}) {
  if (!inicio || !fim || erroDoPeriodoMensal(inicio, fim)) {
    return (
      <p className="-mt-2 text-xs text-muted-foreground md:col-span-2">
        O período define o trimestre do orçamento: ao escolher o início, o fim
        vem com o último dia do trimestre, e os meses da planilha nascem dele.
      </p>
    );
  }

  const meses = mesesDoPeriodo({ inicio, fim });
  const fora = mesesForaDoPeriodo(inicio, fim);
  const ultimo = meses[meses.length - 1];
  const textoFora = juntar(fora.map(nomeDoMes));

  return (
    <div className="-mt-2 space-y-1.5 md:col-span-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>Meses da planilha:</span>
        {meses.map((m, i) => {
          // O primeiro vem do Início previsto: sem ×. O do meio fica
          // apagado enquanto houver mês depois dele.
          const motivo =
            i === 0
              ? undefined
              : m !== ultimo
                ? `Os meses do período são seguidos: para excluir ${nomeDoMes(m)}, exclua antes ${nomeDoMes(ultimo)}.`
                : null;
          const dica = motivo ?? `Excluir ${nomeDoMes(m)}`;
          return (
            <span key={m} className="inline-flex items-center gap-0.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2.5 py-0.5 text-[11px] font-semibold text-foreground">
                <CalendarDays className="h-3 w-3 text-muted-foreground" />
                {rotuloMesCurto(m)}
              </span>
              {motivo !== undefined && (
                <button
                  type="button"
                  title={dica}
                  aria-label={dica}
                  disabled={motivo !== null}
                  onClick={() => onFim(ultimoDiaDoMes(meses[meses.length - 2]))}
                  className="flex items-center justify-center rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-california-red disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/60"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          );
        })}
      </div>
      {fora.length > 0 && (
        <p className="text-xs text-amber-700">
          {textoFora.charAt(0).toUpperCase() + textoFora.slice(1)}{" "}
          {fora.length === 1 ? "fica" : "ficam"} de fora do{" "}
          {rotuloTrimestre(trimestreDe(inicio))}.
        </p>
      )}
    </div>
  );
}
