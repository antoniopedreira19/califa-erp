"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * As peças comuns dos menus de seleção de orçamentos — "Exportar" (página
 * do projeto e visão agregada) e "Exibir" (visão agregada).
 *
 * Design `Exportar e Exibir - Projeto e Visao Agregada.dc.html` (projeto
 * Claude Design `69342d83`, 03/09/2026). O botão segue o padrão do
 * "Exportar" da versão do orçamento (`acoes-versao.tsx`): outline, ícone
 * pequeno, e o popover ancorado logo abaixo, fechando com clique fora ou
 * Esc — sem overlay.
 */

/** Fecha o menu ao clicar fora da âncora ou teclar Esc. */
export function useFecharMenu(
  aberto: boolean,
  ancoraRef: React.RefObject<HTMLElement>,
  fechar: () => void,
) {
  React.useEffect(() => {
    if (!aberto) return;

    function onMouseDown(e: MouseEvent) {
      if (!ancoraRef.current?.contains(e.target as Node)) fechar();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") fechar();
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [aberto, ancoraRef, fechar]);
}

export function BotaoMenu({
  icone,
  rotulo,
  ativo,
  onClick,
}: {
  icone: React.ReactNode;
  rotulo: string;
  ativo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={ativo}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red",
        ativo && "border-california-red/40 text-california-red",
      )}
    >
      {icone}
      {rotulo}
    </button>
  );
}

/** A caixa do menu, ancorada sob o botão. */
export function CaixaMenu({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-label={titulo}
      className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-[368px] overflow-hidden rounded-xl border border-[#d7d5cf] bg-white text-left shadow-elevated"
    >
      <p className="border-b border-border px-3 pb-1.5 pt-2.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-[#9a9a9a]">
        {titulo}
      </p>
      {children}
    </div>
  );
}

/**
 * Uma linha do seletor: caixa de marcação, rótulo, chip de estágio e, no
 * Exportar, o valor à direita.
 *
 * `alerta` é a linha marcada que trava a ação (job aberto no Exportar):
 * fundo avermelhado e caixa vermelha, para o olho achar de longe o que
 * precisa ser desmarcado.
 */
export function LinhaOrcamento({
  marcado,
  alerta,
  desabilitado,
  rotulo,
  chip,
  chipClasses,
  direita,
  onClick,
}: {
  marcado: boolean;
  alerta?: boolean;
  desabilitado?: boolean;
  rotulo: string;
  chip: string;
  chipClasses: string;
  direita?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={marcado}
      disabled={desabilitado}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-[7px] text-left text-[12.5px] font-semibold whitespace-nowrap transition-colors",
        desabilitado
          ? "cursor-not-allowed text-[#9a9a9a]/70"
          : "hover:bg-[#f7f7f6]",
        !desabilitado && !marcado && "text-[#9a9a9a]",
        marcado && alerta && "bg-california-red/5",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-[15px] w-[15px] flex-none items-center justify-center rounded-[4px] border",
          marcado
            ? alerta
              ? "border-california-red bg-california-red text-white"
              : "border-foreground bg-foreground text-white"
            : "border-[#d7d5cf] bg-white text-transparent",
        )}
      >
        <Check className="h-[11px] w-[11px]" strokeWidth={3} />
      </span>
      <span className="min-w-0 truncate">{rotulo}</span>
      <span
        className={cn(
          "flex-none rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.04em]",
          chipClasses,
          !marcado && "opacity-60",
        )}
      >
        {chip}
      </span>
      {direita !== undefined && (
        <span className="ml-auto flex-none font-mono text-[11px] font-normal text-muted-foreground">
          {direita}
        </span>
      )}
    </button>
  );
}
