"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverAnchor = PopoverPrimitive.Anchor;

/**
 * O gatilho pega o foco no clique (22/09/2026). No Safari (e no Firefox
 * do Mac), clicar num botão NÃO dá foco a ele; o foco fica no ancestral
 * focável, que num diálogo é o próprio `DialogContent`. Aí, ao abrir o
 * popover, a trava de foco do diálogo devolve o foco para esse contêiner.
 * O popover lê isso como "o foco saiu para fora" e fecha no mesmo instante.
 * No Chrome o foco devolvido cai no gatilho, que o popover reconhece e
 * ignora. Resultado no Safari: nenhum DatePicker/Combobox dentro de
 * diálogo ou drawer abria (visto no "Enviar job para abertura").
 *
 * O foco vai no `click`, não no `pointerdown`: o `mousedown` do Safari
 * move o foco para o ancestral DEPOIS do pointerdown e o roubaria de
 * volta. O handler de quem usa roda depois, e o toggle do Radix por último.
 */
const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(({ onClick, ...props }, ref) => (
  <PopoverPrimitive.Trigger
    ref={ref}
    onClick={(event) => {
      if (document.activeElement !== event.currentTarget) {
        event.currentTarget.focus({ preventScroll: true });
      }
      onClick?.(event);
    }}
    {...props}
  />
));
PopoverTrigger.displayName = PopoverPrimitive.Trigger.displayName;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        // z-[70]: ACIMA dos diálogos (16/09/2026). A escala do ERP é
        // 50 (tela) / 55 (tela cheia) / 60 (diálogo aberto de dentro de
        // outra camada) — e o popover pertence sempre ao que está por cima,
        // não à página. Em z-50 o calendário do DatePicker abria ATRÁS do
        // diálogo de aprovar PP (z-[60]): dava para clicar por script, mas
        // não com o mouse, e a data ficava impossível de escolher.
        "z-[70] rounded-xl border border-border bg-white p-3 text-foreground shadow-elevated outline-none",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
