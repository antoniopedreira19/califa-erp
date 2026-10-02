"use client";

/**
 * As abas da seção Fiscal (módulo fiscal, entrega 2): **Apuração** e
 * **Impostos a Pagar**. A aba vive na URL (`?aba=impostos`; a Apuração é a
 * URL sem `aba`) e cada uma é lida no servidor só quando está aberta; a aba
 * clicada acende na hora e o conteúdo fica esmaecido até o servidor
 * responder, como nas abas da conciliação de uma conta.
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type AbaFiscal = "apuracao" | "impostos";

export function AbasFiscal({
  aba,
  totalAAprovar,
  totalAPagar,
  children,
}: {
  aba: AbaFiscal;
  /** Guias a aprovar (ou com diferença) — só com a Apuração aberta. */
  totalAAprovar: number | null;
  /** Impostos em aberto. */
  totalAPagar: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = React.useTransition();
  const [pedida, setPedida] = React.useState<AbaFiscal>(aba);
  React.useEffect(() => setPedida(aba), [aba]);

  function irPara(proxima: AbaFiscal) {
    if (proxima === pedida) return;
    setPedida(proxima);
    const params = new URLSearchParams(searchParams.toString());
    if (proxima === "apuracao") params.delete("aba");
    else params.set("aba", proxima);
    const qs = params.toString();
    startTransition(() => {
      router.replace(`/financeiro/fiscal${qs ? `?${qs}` : ""}`, { scroll: false });
    });
  }

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Seções do fiscal" className="flex items-center gap-1 border-b border-border">
        <TabButton
          active={pedida === "apuracao"}
          onClick={() => irPara("apuracao")}
          count={totalAAprovar ?? undefined}
        >
          Apuração
        </TabButton>
        <TabButton active={pedida === "impostos"} onClick={() => irPara("impostos")} count={totalAPagar}>
          Impostos a Pagar
        </TabButton>
      </div>
      <div
        role="tabpanel"
        aria-busy={isPending || undefined}
        className={cn("space-y-6 transition-opacity", isPending && "opacity-60")}
      >
        {children}
      </div>
    </div>
  );
}

/** O botão de aba de Contas a Pagar e da conciliação. */
function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:text-california-red",
        active
          ? "border-california-red text-california-red"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
            active ? "bg-california-red text-white" : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
