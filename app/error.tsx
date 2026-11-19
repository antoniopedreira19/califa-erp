"use client";

/**
 * Error boundary de nível do App Router.
 *
 * Captura qualquer throw em server component ou client component dentro do
 * `app/` e substitui a tela branca que o Next mostra por default em produção
 * por uma página com:
 *   - mensagem clara pro usuário
 *   - botão "Tentar de novo" (dispara `reset()`)
 *   - `digest` do erro visível, pra quem receber o print conseguir achar o
 *     log correspondente na Vercel
 *
 * Em desenvolvimento, `error.message` vem com a stack; em produção, só o
 * `digest`. É assim que o Next entrega — não vaza mensagem sensível pro
 * usuário final.
 */

import * as React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[app/error] server/client throw:", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-border bg-white p-8 shadow-soft text-center space-y-5">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-california-red/10">
          <AlertTriangle className="h-6 w-6 text-california-red" />
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-foreground">
            Algo quebrou ao carregar esta página
          </h1>
          <p className="text-sm text-muted-foreground">
            Tente de novo. Se continuar, mande o código abaixo pro admin.
          </p>
        </div>
        {error.digest && (
          <div className="rounded-lg bg-muted px-3 py-2 font-mono text-xs text-muted-foreground break-all">
            {error.digest}
          </div>
        )}
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-xl bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-brand transition-colors hover:bg-california-red-hover"
        >
          <RotateCcw className="h-4 w-4" />
          Tentar de novo
        </button>
      </div>
    </div>
  );
}
