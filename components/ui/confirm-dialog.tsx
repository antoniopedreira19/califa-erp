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
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {variant === "destructive" && (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-california-red">
                <AlertTriangle className="h-5 w-5" />
              </div>
            )}
            <div className="space-y-1 flex-1">
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <DialogDescription>{description}</DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

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
            disabled={pending}
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
