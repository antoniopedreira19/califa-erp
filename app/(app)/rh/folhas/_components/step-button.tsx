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
  /** Text abaixo do label; ex.: contador, valor. */
  sublabel?: string;
}

/**
 * Botão de passo da timeline do card de folha.
 *
 * Tamanho uniforme (`h-16`, `flex-1`) pra permitir alinhamento numa linha
 * horizontal via flex. Visual varia por `state`:
 * - done: fundo esmeralda claro, texto esmeralda, ícone Check.
 * - current: fundo California red, texto branco, negrito.
 * - locked: fundo muted, texto cinza, cursor-not-allowed.
 */
export function StepButton(props: StepButtonProps): JSX.Element {
  const { state, pending, disabled } = props;
  const isLocked = state === "locked";
  const isCurrent = state === "current";
  const isDone = state === "done";

  const baseClass =
    "group relative flex h-16 w-full flex-col items-center justify-center gap-0.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors";

  const stateClass = isCurrent
    ? "border-california-red bg-california-red text-white shadow-sm hover:bg-california-red/90 disabled:opacity-60 disabled:cursor-not-allowed"
    : isDone
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
      : "border-border bg-muted/40 text-muted-foreground cursor-not-allowed";

  const Icon = isDone ? Check : props.icon;

  return (
    <button
      type="button"
      onClick={isLocked || disabled ? undefined : props.onClick}
      disabled={isLocked || disabled || pending}
      title={props.title}
      className={`${baseClass} ${stateClass}`}
    >
      <div className="flex items-center gap-1.5">
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Icon className="h-4 w-4" aria-hidden />
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
          {props.step}
        </span>
        <span>{pending ? "Processando..." : props.label}</span>
      </div>
      {props.sublabel && !pending && (
        <span className="text-[10px] font-normal opacity-80">
          {props.sublabel}
        </span>
      )}
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
      className="hidden sm:flex items-center justify-center text-muted-foreground shrink-0 px-1"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
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
