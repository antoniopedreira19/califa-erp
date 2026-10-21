"use client";

/**
 * A dica das planilhas de títulos (decisão 195): abre ao passar o mouse e
 * fica aberta no clique; clicar fora, Esc ou rolar a página fecham. Serve
 * à Regional, ao Centro de Custo e aos valores destrinchados — o que não
 * cabe na célula de uma `table-fixed` mora aqui.
 *
 * Por que não o `Tooltip` do Radix: ele só abre no mouse, e a dica precisa
 * ficar presa para o financeiro ler o rateio inteiro ou copiar um número.
 * Por que não o `Popover` cru: ele só abre no clique. Este é o Popover do
 * Radix controlado pelos dois gestos — com o portal e o `z-[70]` dos
 * conteúdos flutuantes (docs/09, regra de layer), para abrir por cima de um
 * diálogo quando for preciso.
 */

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

type Estado = null | "mouse" | "preso";

export function Dica({
  conteudo,
  children,
  className,
  rotulo,
  largura = 300,
}: {
  /** Sem conteúdo, a dica não existe e o filho aparece sozinho. */
  conteudo: React.ReactNode | null;
  children: React.ReactNode;
  className?: string;
  /** O nome acessível do gatilho, quando o filho é só um ícone. */
  rotulo?: string;
  largura?: number;
}) {
  const [estado, setEstado] = React.useState<Estado>(null);
  const gatilho = React.useRef<HTMLButtonElement>(null);
  const caixa = React.useRef<HTMLDivElement>(null);

  // Rolar fecha (a dica fica presa ao lugar da célula, que andou). Rolar
  // dentro da própria dica, não.
  React.useEffect(() => {
    if (!estado) return;
    const rolou = (e: Event) => {
      if (caixa.current && e.target instanceof Node && caixa.current.contains(e.target)) return;
      setEstado(null);
    };
    window.addEventListener("scroll", rolou, true);
    return () => window.removeEventListener("scroll", rolou, true);
  }, [estado]);

  if (conteudo === null || conteudo === undefined || conteudo === "") {
    return <span className={className}>{children}</span>;
  }

  // O clique no próprio gatilho não conta como "fora": é ele que prende.
  const doGatilho = (alvo: EventTarget | null) =>
    alvo instanceof Node && gatilho.current !== null && gatilho.current.contains(alvo);

  return (
    <PopoverPrimitive.Root open={estado !== null} onOpenChange={(aberto) => !aberto && setEstado(null)}>
      <PopoverPrimitive.Anchor asChild>
        <button
          ref={gatilho}
          type="button"
          aria-label={rotulo}
          aria-expanded={estado !== null}
          onMouseEnter={() => setEstado((e) => e ?? "mouse")}
          onMouseLeave={() => setEstado((e) => (e === "mouse" ? null : e))}
          onClick={(e) => {
            e.stopPropagation();
            setEstado((atual) => (atual === "preso" ? null : "preso"));
          }}
          className={cn("max-w-full cursor-pointer text-left", className)}
        >
          {children}
        </button>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={caixa}
          role="tooltip"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          // A dica não leva o foco: no mouse, ela só se mostra.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => doGatilho(e.target) && e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: largura }}
          className="z-[70] rounded-lg bg-[#282828] px-3 py-2 text-[11.5px] leading-relaxed text-white shadow-elevated outline-none"
        >
          {conteudo}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
