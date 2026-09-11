"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dialog / Drawer padrão do sistema.
 *
 * `Dialog*` = modal centered clássico (confirmações, alertas).
 * `Drawer*` = mesma base, mas o conteúdo desliza da direita e ocupa
 *            altura total. Ideal para edições ocasionais que não devem
 *            empurrar o conteúdo da página.
 *
 * Ambos usam Radix Dialog embaixo (acessibilidade completa: focus trap,
 * ESC, click-outside).
 */

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/** Dialog centered clássico. */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /**
     * Classe do véu. Existe por um motivo só: um diálogo aberto de dentro
     * de uma camada em tela cheia precisa subir o véu JUNTO com o cartão,
     * senão o véu fica atrás e o cartão flutua sobre uma tela que não
     * escureceu — ver a escala de camadas no `FullscreenContent`.
     */
    overlayClassName?: string;
  }
>(({ className, overlayClassName, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-border bg-card p-6 shadow-elevated",
        // Teto de altura no PRIMITIVO, e não em cada tela: o diálogo é
        // centrado por translate, então um conteúdo mais alto que a
        // janela escapa pelos DOIS lados — some o título em cima e os
        // botões embaixo, sem barra de rolagem nenhuma. Foi o que
        // aconteceu com a confirmação do envio do job numa tela de
        // 840px: "Sim, enviar job" ficava fora do alcance do mouse
        // (31/08/2026). Quem já declara o próprio `max-h` continua
        // mandando — o `className` entra depois no `cn`.
        "max-h-[88vh] overflow-y-auto",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-california-red transition-colors focus:outline-none focus:ring-2 focus:ring-california-red/40"
        aria-label="Fechar"
      >
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

/** Drawer que desliza da direita, altura total. */
const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l border-border bg-card shadow-elevated sm:max-w-lg",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=open]:duration-300",
        "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DrawerContent.displayName = "DrawerContent";

/**
 * Conteúdo que ocupa a janela inteira, sem overlay próprio.
 *
 * Existe por causa de um defeito real: a conferência de documentos do
 * financeiro era uma `<div class="fixed inset-0 z-[75]">` solta na árvore
 * da página, aberta POR CIMA do drawer da PP. Só que o Radix, num modal,
 * põe `pointer-events: none` no `<body>` e devolve `auto` apenas para o
 * layer dele — então TUDO que fica fora do portal vira decoração: o
 * "Fechar", os botões de anexo e o "Aprovar" daquela tela não recebiam
 * clique nenhum, e o único jeito de sair era acertar o overlay do drawer
 * por baixo, que fechava a PP inteira (10/09/2026).
 *
 * Passando pelo portal do Radix, esta camada entra na pilha de layers: ela
 * fica clicável e o ESC fecha só ela.
 *
 * ⚠️ **A escala de `z` é explícita de propósito** (corrigido em
 * 10/09/2026). Eu havia escrito aqui que bastava deixar todo mundo em
 * `z-50` porque "a ordem do DOM decide". Não decide: o React insere os
 * portais na ordem da ÁRVORE, não na ordem em que abrem, e o pop-up de
 * aprovação apareceu ATRÁS do `<iframe>` do documento — botão visível,
 * inalcançável. A escala que vale:
 *
 * - `z-50` — drawer e diálogos comuns, o padrão do sistema;
 * - `z-[55]` — esta camada, que cobre a janela inteira;
 * - `z-[60]` — diálogo aberto de DENTRO dela (véu junto, via
 *   `overlayClassName`).
 *
 * Diálogo que pode ser aberto dos dois lugares leva `z-[60]` sempre: sobre
 * o drawer, funciona igual.
 *
 * Sem `DialogOverlay`: o conteúdo já cobre a janela e pinta o próprio
 * fundo — o overlay do Radix só somaria escuro sobre escuro.
 */
const FullscreenContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogPrimitive.Content
      ref={ref}
      // Não existe "clicar fora" numa camada que cobre a janela inteira:
      // todo dismiss por fora daqui é falso positivo. O suspeito é o
      // `<iframe>` — clique dentro dele acontece em OUTRO documento, o
      // navegador tira o foco do nosso, e o Radix lê isso como interação
      // externa e fecha a tela na cara de quem só queria dar zoom no PDF.
      // Sai pelo "Fechar" ou pelo ESC, e por mais nada.
      onPointerDownOutside={(e) => e.preventDefault()}
      onFocusOutside={(e) => e.preventDefault()}
      onInteractOutside={(e) => e.preventDefault()}
      className={cn(
        "fixed inset-0 z-[55] flex h-full w-full flex-col outline-none",
        // Entra com fade, sai na hora — de propósito. O Radix só desmonta
        // o conteúdo animado quando o `animationend` chega, e navegador
        // que não anima (aba em segundo plano, `prefers-reduced-motion`)
        // não manda esse evento. Num diálogo comum isso deixaria um cartão
        // esquecido no meio da tela; aqui deixaria uma cortina opaca por
        // cima do sistema inteiro. O fade de saída não paga esse risco.
        "data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
));
FullscreenContent.displayName = "FullscreenContent";

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-left", className)}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DrawerContent,
  FullscreenContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
