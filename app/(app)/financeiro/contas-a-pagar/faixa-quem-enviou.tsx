"use client";

/**
 * A faixa "Enviada por X em …" dos pop-ups de aprovar PP e aprovar
 * prestação de contas (decisão 136).
 *
 * Qualquer GP envia PP de qualquer job, e o produtor presta contas da
 * verba: quem age já não é, necessariamente, o GP responsável. A faixa diz
 * quem mandou e quando; a segunda linha deixa as outras pessoas do caso
 * como referência.
 */

import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDataAsHoraBr } from "@/lib/formatar-data-hora";

export function FaixaQuemEnviou({
  rotulo,
  nome,
  em,
  referencia,
  className,
}: {
  /** "Enviada por", "Reenviada por", "Prestação enviada por"… */
  rotulo: string;
  nome: string | null;
  em: string | null;
  /** A linha de baixo: quem emitiu, o responsável pela verba, o GP. */
  referencia: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-california-red/15 bg-california-red/5 px-3.5 py-2.5 text-left text-[12.5px] leading-relaxed",
        className,
      )}
    >
      <Send className="mt-0.5 h-4 w-4 shrink-0 text-california-red" />
      <div>
        <div>
          <span className="text-muted-foreground">{rotulo}</span>{" "}
          <strong className="font-semibold text-foreground">{nome ?? "—"}</strong>
          {em ? <span className="text-muted-foreground"> em {formatDataAsHoraBr(em)}</span> : null}
        </div>
        <div className="text-[11.5px] text-muted-foreground">{referencia}</div>
      </div>
    </div>
  );
}
