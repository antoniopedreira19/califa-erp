"use client";

/**
 * Sticky de aprovação em lote de PPs — mesmo desenho da `BarraDeSelecao` de
 * Títulos a Pagar (fundo #282828, rounded-2xl, shadow-elevated, grudada no
 * pé). Aqui o verbo é "Seguir para aprovação": a barra mostra o total das
 * selecionadas e abre a PRIMEIRA PP; o restante vira fila dentro da PP tela,
 * que avança sozinha a cada aprovação.
 *
 * A barra não reusa `BarraDeSelecao` de `baixa-em-lote` porque aquela carrega
 * o vocabulário de títulos (Saem/Entram, conta, saldo depois). Aqui é só
 * "N PPs · Total · Seguir" — mais simples de ler e de manter.
 */

import * as React from "react";

/** Caixa do cabeçalho: marca/desmarca todas as PPs "Em avaliação" visíveis.
 *  Estado misto (`indeterminate`) quando algumas estão marcadas. Fora da
 *  aba "Em avaliação" o cabeçalho não renderiza esta caixa. */
export function CaixaDoCabecalhoPPs({
  todas,
  algumas,
  onAlternar,
  desabilitada,
}: {
  todas: boolean;
  algumas: boolean;
  onAlternar: () => void;
  desabilitada?: boolean;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = algumas;
  }, [algumas]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={todas}
      disabled={desabilitada}
      aria-label="Selecionar todas as PPs em avaliação"
      title={
        desabilitada
          ? "Nenhuma PP em avaliação visível"
          : todas
            ? "Tirar todas da seleção"
            : "Selecionar todas as PPs em avaliação"
      }
      onChange={onAlternar}
      className="h-4 w-4 cursor-pointer accent-california-red disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}

/** Caixa da linha: idêntica ao visual da baixa em lote de Títulos. */
export function CaixaDaLinhaPPs({
  marcada,
  onAlternar,
}: {
  marcada: boolean;
  onAlternar: () => void;
}) {
  return (
    <input
      type="checkbox"
      checked={marcada}
      onChange={onAlternar}
      onClick={(e) => e.stopPropagation()}
      aria-label={marcada ? "Tirar da seleção" : "Adicionar à seleção"}
      className="h-4 w-4 cursor-pointer accent-california-red"
    />
  );
}

function moeda(v: number): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function BarraDeSelecaoPPs({
  quantidade,
  total,
  onLimpar,
  onSeguir,
}: {
  quantidade: number;
  /** Soma do valor bruto das PPs selecionadas (antes de retenções). */
  total: number;
  onLimpar: () => void;
  onSeguir: () => void;
}) {
  if (quantidade === 0) return null;
  return (
    <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-4 rounded-2xl bg-[#282828] py-2.5 pl-5 pr-2.5 text-sm text-white shadow-elevated">
        <span className="font-semibold">
          {quantidade} {quantidade === 1 ? "PP selecionada" : "PPs selecionadas"}
        </span>
        <span className="h-4 w-px bg-white/20" />
        <span className="text-white/75">
          Total <strong className="font-mono font-semibold text-white">{moeda(total)}</strong>
        </span>
        <span className="h-4 w-px bg-white/20" />
        <button
          type="button"
          onClick={onLimpar}
          className="text-white/75 underline-offset-2 hover:text-white hover:underline"
        >
          Limpar seleção
        </button>
        <button
          type="button"
          onClick={onSeguir}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
        >
          Seguir para aprovação
        </button>
      </div>
    </div>
  );
}
