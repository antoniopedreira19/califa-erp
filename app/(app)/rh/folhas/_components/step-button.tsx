"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Check, Loader2 } from "lucide-react";

export type StepState = "done" | "current" | "locked";

export interface StepButtonProps {
  /** Número do passo (1-based). Mostrado como prefixo. */
  step: number;
  /** Texto principal do botão. */
  label: string;
  /** Estado visual: done (concluído) | current (ação principal) | locked (bloqueado). */
  state: StepState;
  /** Ícone do passo (lucide). Sobrescrito por Check quando state=done. */
  icon: LucideIcon;
  /** Chamado quando o botão é clicado (ignorado se state=locked ou disabled). */
  onClick?: () => void;
  /** Estado de loading durante uma action em curso. */
  pending?: boolean;
  /** Força desabilitado mesmo que state=current. */
  disabled?: boolean;
  /** Tooltip no hover (útil pra explicar por que está locked). */
  title?: string;
}

/**
 * Botão de passo da timeline do card de folha.
 *
 * Minimalista: altura `h-10`, inline (ícone + número + label), `flex-1` pra
 * alinhar numa linha horizontal via flex. Visual varia por `state`:
 * - done: borda e texto esmeralda, fundo branco, ícone Check.
 * - current: California red, texto branco, negrito.
 * - locked: fundo transparente, texto cinza, cursor-not-allowed.
 */
export function StepButton(props: StepButtonProps): JSX.Element {
  const { state, pending, disabled } = props;
  const isLocked = state === "locked";
  const isCurrent = state === "current";
  const isDone = state === "done";

  const baseClass =
    "group relative inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors";

  const stateClass = isCurrent
    ? "border-california-red bg-california-red text-white shadow-sm hover:bg-california-red/90 disabled:opacity-60 disabled:cursor-not-allowed font-semibold"
    : isDone
      ? "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
      : "border-border bg-transparent text-muted-foreground cursor-not-allowed";

  const Icon = isDone ? Check : props.icon;

  return (
    <button
      type="button"
      onClick={isLocked || disabled ? undefined : props.onClick}
      disabled={isLocked || disabled || pending}
      title={props.title}
      className={`${baseClass} ${stateClass}`}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <span className="opacity-60 text-[10px] font-semibold">{props.step}</span>
      <span className="truncate">
        {pending ? "Processando..." : props.label}
      </span>
    </button>
  );
}

/**
 * Seta de conexão entre dois StepButtons na timeline. Fica invisível em
 * telas estreitas (sm:); o flex em coluna cuida da fallback.
 */
export function StepArrow(): JSX.Element {
  return (
    <div
      aria-hidden
      className="hidden sm:flex items-center justify-center text-muted-foreground/60 shrink-0"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </div>
  );
}
