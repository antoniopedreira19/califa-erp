import { CheckCircle2 } from "lucide-react";

/**
 * Renderizado quando o array `pendencias` do papel esta vazio (todos os
 * cards zeraram). Estado positivo, nao passivo — o usuario ve rapido que
 * nao ha pendencia, sem precisar ler cada card cinza.
 */
export function EstadoVazio({ mensagem }: { mensagem: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
        <CheckCircle2 className="h-5 w-5" />
      </div>
      <p className="mt-4 text-sm font-semibold text-foreground">
        {mensagem}
      </p>
    </div>
  );
}
