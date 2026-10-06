"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type Tag = "div" | "span" | "p" | "h1" | "h2" | "h3" | "h4" | "h5";

interface Props {
  text: string;
  className?: string;
  maxWidth?: number;
  as?: Tag;
  /** Quebra o texto em até N linhas e corta o resto com "…". Sem ele, o
   *  texto fica numa linha só. O cartão com o texto inteiro abre nos dois
   *  casos, e só quando houve corte. */
  linhas?: 2 | 3;
}

// Classe inteira por valor: o Tailwind não enxerga `line-clamp-${n}`.
const CLAMP = { 2: "line-clamp-2", 3: "line-clamp-3" } as const;

export function TruncateTooltip({
  text,
  className,
  maxWidth = 360,
  as: Component = "div",
  linhas,
}: Props) {
  const ref = React.useRef<HTMLElement>(null);
  const [pos, setPos] = React.useState<
    | { top: number; left: number; minWidth: number }
    | null
  >(null);

  function abrir() {
    const el = ref.current;
    if (!el) return;
    const cortado = linhas
      ? el.scrollHeight > el.clientHeight + 1
      : el.scrollWidth > el.clientWidth + 1;
    if (!cortado) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, minWidth: r.width });
  }

  function fechar() {
    setPos(null);
  }

  React.useEffect(() => {
    if (!pos) return;
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    return () => {
      window.removeEventListener("scroll", fechar, true);
      window.removeEventListener("resize", fechar);
    };
  }, [pos]);

  return (
    <>
      <Component
        ref={ref as React.RefObject<never>}
        className={cn(
          // `break-words`: uma palavra maior que a coluna quebra em vez de
          // vazar para a célula vizinha.
          linhas ? `${CLAMP[linhas]} break-words` : "truncate",
          className,
        )}
        onMouseEnter={abrir}
        onMouseLeave={fechar}
      >
        {text}
      </Component>
      {pos && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                minWidth: pos.minWidth,
                maxWidth,
              }}
              className="pointer-events-none z-50 whitespace-normal break-words rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs leading-snug text-popover-foreground shadow-elevated"
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
