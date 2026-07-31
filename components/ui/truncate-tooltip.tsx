"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface Props {
  text: string;
  className?: string;
  maxWidth?: number;
}

export function TruncateTooltip({ text, className, maxWidth = 360 }: Props) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<
    | { top: number; left: number; minWidth: number }
    | null
  >(null);

  function abrir() {
    const el = ref.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth + 1) return;
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
      <div
        ref={ref}
        className={cn("truncate", className)}
        onMouseEnter={abrir}
        onMouseLeave={fechar}
      >
        {text}
      </div>
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
