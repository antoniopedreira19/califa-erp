"use client";

/**
 * As abas da seção Fiscal (módulo fiscal, entrega 2): **Apuração** e
 * **Impostos a Pagar**. A aba vive na URL (`?aba=impostos`; a Apuração é a
 * URL sem `aba`) e cada uma é lida no servidor só quando está aberta; a aba
 * clicada acende na hora e o conteúdo fica esmaecido até o servidor
 * responder, como nas abas da conciliação de uma conta.
 *
 * O número de cada aba chega pronto do servidor (`<ContagemDaAba>`): o da
 * Apuração, com a outra aba aberta, vem num `Suspense` da página, porque
 * exige o cálculo inteiro. A cor do número (aba ativa ou não) sai do
 * contexto do botão, que o servidor não conhece.
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type AbaFiscal = "apuracao" | "impostos";

/** A aba do botão em que o número está: a cor dele muda com ela. */
const AbaAtiva = React.createContext(false);

/** O número de uma aba (some quando é zero). */
export function ContagemDaAba({ total }: { total: number }) {
  const ativa = React.useContext(AbaAtiva);
  if (total <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
        ativa ? "bg-california-red text-white" : "bg-muted text-muted-foreground",
      )}
    >
      {total}
    </span>
  );
}

export function AbasFiscal({
  aba,
  seloApuracao,
  totalAPagar,
  children,
}: {
  aba: AbaFiscal;
  /** As guias a aprovar (ou com diferença): um `<ContagemDaAba>`, direto ou num `Suspense`. */
  seloApuracao: React.ReactNode;
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
        <TabButton active={pedida === "apuracao"} onClick={() => irPara("apuracao")} selo={seloApuracao}>
          Apuração
        </TabButton>
        <TabButton
          active={pedida === "impostos"}
          onClick={() => irPara("impostos")}
          selo={<ContagemDaAba total={totalAPagar} />}
        >
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
  selo,
  children,
}: {
  active: boolean;
  onClick: () => void;
  selo: React.ReactNode;
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
      <AbaAtiva.Provider value={active}>{selo}</AbaAtiva.Provider>
    </button>
  );
}
