"use client";

/**
 * As abas da conciliação de uma conta (pedido do Tiago em 02/10/2026):
 * **Extrato** — os cartões de saldo e o extrato de sempre — e **Títulos** —
 * tudo que aguarda baixa no financeiro, igual para todas as contas.
 *
 * A aba vive na URL (`&aba=titulos`; o Extrato é a URL sem `aba`) e cada
 * uma é lida no servidor só quando está aberta: o Extrato não paga pela
 * leitura dos títulos. Por isso trocar de aba vai ao servidor; a aba
 * clicada acende na hora e o conteúdo fica esmaecido até ele responder,
 * como nos filtros da conta. `replace`, e não `push`: trocar de aba não
 * empilha o "voltar" do navegador, como nas abas de Contas a Pagar.
 *
 * O desenho é o das abas de Contas a Pagar.
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type AbaDaConta = "extrato" | "titulos";

/** A barra das abas e, embaixo, o conteúdo da aba aberta (que a página
 *  monta no servidor). A página lê `?aba=` por conta própria: função de
 *  módulo cliente não roda no servidor. */
export function AbasDaConta({
  aba,
  totalTitulos,
  children,
}: {
  aba: AbaDaConta;
  /** Quantos títulos aguardam baixa — só se sabe com a aba Títulos aberta
   *  (no Extrato eles nem são lidos), e por isso no Extrato não há número. */
  totalTitulos: number | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = React.useTransition();
  // A aba clicada acende antes de o servidor responder.
  const [pedida, setPedida] = React.useState<AbaDaConta>(aba);
  React.useEffect(() => setPedida(aba), [aba]);

  function irPara(proxima: AbaDaConta) {
    if (proxima === pedida) return;
    setPedida(proxima);
    const params = new URLSearchParams(searchParams.toString());
    if (proxima === "extrato") params.delete("aba");
    else params.set("aba", proxima);
    // O destaque é de uma linha do extrato: não atravessa a troca de aba.
    params.delete("highlight");
    startTransition(() => {
      router.replace(`/financeiro/conciliacao?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <>
      <div
        role="tablist"
        aria-label="Seções da conciliação"
        className="flex items-center gap-1 border-b border-border"
      >
        <TabButton active={pedida === "extrato"} onClick={() => irPara("extrato")}>
          Extrato
        </TabButton>
        <TabButton
          active={pedida === "titulos"}
          onClick={() => irPara("titulos")}
          count={totalTitulos ?? undefined}
        >
          Títulos
        </TabButton>
      </div>

      <div
        role="tabpanel"
        aria-busy={isPending || undefined}
        className={cn("space-y-6 transition-opacity", isPending && "opacity-60")}
      >
        {children}
      </div>
    </>
  );
}

/** O botão de aba de Contas a Pagar (`contas-pagar-tabs.tsx`), sem o
 *  contador de chats. */
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
