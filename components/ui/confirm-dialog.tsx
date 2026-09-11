"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Variant = "default" | "destructive";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
  pending?: boolean;
  /** Desabilita só o botão de confirmar — o cancelar continua ativo.
   *  Para ação que ainda não pode ser executada, mas cujo fluxo já é
   *  mostrado ao usuário. Use junto com `confirmDisabledReason`. */
  confirmDisabled?: boolean;
  /** Nota exibida acima dos botões explicando por que confirmar está
   *  travado. Sem ela o botão morto parece defeito. */
  confirmDisabledReason?: React.ReactNode;
  /**
   * Camada do cartão e do véu. Só é preciso quando a confirmação é aberta
   * de DENTRO de uma tela cheia (`FullscreenContent`), que fica acima do
   * `z-50` padrão — sem isso o cartão monta atrás dela. Ver a escala de
   * camadas em `components/ui/dialog.tsx` (10/09/2026).
   */
  contentClassName?: string;
  overlayClassName?: string;
  onConfirm: () => void | Promise<void>;
}

/**
 * Confirmação padrão do sistema. Substitui o `window.confirm()` nativo.
 * Uso: cada consumidor controla `open` local (state) e passa `onConfirm`.
 *
 * Ex.:
 *   <ConfirmDialog
 *     open={askDelete !== null}
 *     onOpenChange={(o) => !o && setAskDelete(null)}
 *     title="Remover item?"
 *     description="A ação não pode ser desfeita."
 *     variant="destructive"
 *     pending={pending}
 *     onConfirm={handleDelete}
 *   />
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "default",
  pending = false,
  confirmDisabled = false,
  confirmDisabledReason,
  contentClassName,
  overlayClassName,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("sm:max-w-md", contentClassName)}
        overlayClassName={overlayClassName}
      >
        <DialogHeader>
          <div className="flex items-start gap-3">
            {variant === "destructive" && (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-california-red">
                <AlertTriangle className="h-5 w-5" />
              </div>
            )}
            {/* pr-6 reserva a trilha do botão de fechar, que é absoluto no
                canto: sem isso, título longo passa por baixo do X. */}
            <div className="space-y-1 flex-1 pr-6">
              <DialogTitle>{title}</DialogTitle>
              {/* `DialogDescription` do Radix renderiza um `<p>`, e metade
                  das telas passa `description` com `<p>` e `<div>` dentro —
                  o que é HTML inválido e o React acusa como erro de
                  hidratação no console (visto em 10/09/2026, no confirm de
                  rejeição da PP). Texto simples continua em `<p>`; conteúdo
                  montado vira `<div>` pelo `asChild`, sem mudar a aparência
                  nem o `aria-describedby`. */}
              {description &&
                (typeof description === "string" ? (
                  <DialogDescription>{description}</DialogDescription>
                ) : (
                  <DialogDescription asChild>
                    <div className="text-sm text-muted-foreground">{description}</div>
                  </DialogDescription>
                ))}
            </div>
          </div>
        </DialogHeader>

        {confirmDisabled && confirmDisabledReason && (
          <div className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {confirmDisabledReason}
          </div>
        )}

        <DialogFooter className="mt-2 gap-2 sm:gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="inline-flex items-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onConfirm()}
            disabled={pending || confirmDisabled}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed",
              variant === "destructive"
                ? "bg-california-red hover:bg-california-red-hover"
                : "bg-california-dark hover:bg-california-dark-soft",
            )}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
