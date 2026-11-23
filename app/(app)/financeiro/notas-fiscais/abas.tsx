"use client";

/**
 * As abas de Notas Fiscais (decisão 271): **Emitidas** (as notas que nós
 * emitimos) e **Tomadas** (as NFs emitidas contra os nossos CNPJs; o nome
 * era "Recebidas", que confundia com recebimento). A aba vive na URL
 * (`?aba=tomadas`; Emitidas é a URL sem `aba`) e cada uma é lida no
 * servidor só quando está aberta — o mesmo desenho das abas do Fiscal.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type AbaDasNotas = "emitidas" | "tomadas";

export function AbasDasNotas({
  aba,
  children,
}: {
  aba: AbaDasNotas;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = React.useTransition();
  const [pedida, setPedida] = React.useState<AbaDasNotas>(aba);
  React.useEffect(() => setPedida(aba), [aba]);

  function irPara(proxima: AbaDasNotas) {
    if (proxima === pedida) return;
    setPedida(proxima);
    const params = new URLSearchParams(searchParams.toString());
    if (proxima === "emitidas") params.delete("aba");
    else params.set("aba", proxima);
    const qs = params.toString();
    startTransition(() => {
      router.replace(`/financeiro/notas-fiscais${qs ? `?${qs}` : ""}`, { scroll: false });
    });
  }

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Notas fiscais" className="flex items-center gap-1 border-b border-border">
        <TabButton active={pedida === "emitidas"} onClick={() => irPara("emitidas")}>
          Emitidas
        </TabButton>
        <TabButton active={pedida === "tomadas"} onClick={() => irPara("tomadas")}>
          Tomadas
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

/** O botão de aba de Contas a Pagar, da conciliação e do Fiscal. */
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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
    </button>
  );
}
