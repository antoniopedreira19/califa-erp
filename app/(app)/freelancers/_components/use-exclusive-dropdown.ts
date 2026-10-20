"use client";

import * as React from "react";

/**
 * Hook pra dropdowns mutuamente exclusivos. Resolve dois comportamentos:
 * 1. Abrir um dropdown fecha automaticamente os outros abertos (via
 *    CustomEvent compartilhado no document).
 * 2. Clicar fora do dropdown fecha ele.
 *
 * Qualquer dropdown que usa este hook participa do grupo. Troca de página
 * ou unmount desregistra os listeners automaticamente.
 */

const EVENT_NAME = "freelancers:dropdown-open";

export function useExclusiveDropdown() {
  const [open, setOpen] = React.useState(false);
  const idRef = React.useRef(Math.random().toString(36).slice(2));
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Fecha quando outro dropdown abre
  React.useEffect(() => {
    function onOtherOpen(e: Event) {
      const ce = e as CustomEvent<string>;
      if (ce.detail !== idRef.current) setOpen(false);
    }
    document.addEventListener(EVENT_NAME, onOtherOpen);
    return () => document.removeEventListener(EVENT_NAME, onOtherOpen);
  }, []);

  // Fecha ao clicar fora
  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function toggleOpen() {
    if (!open) {
      document.dispatchEvent(
        new CustomEvent(EVENT_NAME, { detail: idRef.current }),
      );
    }
    setOpen((o) => !o);
  }

  function close() {
    setOpen(false);
  }

  return { open, toggleOpen, close, containerRef };
}
