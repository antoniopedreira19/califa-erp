"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Empresa } from "@/lib/types";
import { MultiSelectEmpresas } from "@/components/ui/multi-select-empresas";
import { setActiveEmpresas } from "@/app/actions/set-active-empresas";

export type PageHeaderEmpresaFilterProps = {
  empresas: Empresa[];
  activeEmpresas: Empresa[];
};

/**
 * Filtro de empresa com estado otimista + feedback visual.
 *
 * UX:
 * - Clique no checkbox → estado local muda em 0ms (feedback instantâneo).
 * - Nada bate no servidor até o operador FECHAR o Popover.
 * - Ao fechar com mudança: 1 chamada + router.refresh dentro de
 *   useTransition. `isPending=true` durante todo o refresh — só assim
 *   evitamos sobrescrever localIds enquanto o servidor ainda está
 *   respondendo o pedido anterior (bug antigo: dropdown "volta" itens).
 * - Enquanto `isPending`, mostramos barra de progresso no topo (portal
 *   pro body) e cursor "wait" globalmente — o operador vê que algo está
 *   acontecendo.
 */
export function PageHeaderEmpresaFilter({
  empresas,
  activeEmpresas,
}: PageHeaderEmpresaFilterProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  // isCommitting cobre a janela entre "fechou popover" e "startTransition
  // disparou". Sem ele, o await setActiveEmpresas (100-300ms de rede)
  // ficaria sem feedback visual — sensação de travamento no clique.
  const [isCommitting, setIsCommitting] = React.useState(false);
  const isBusy = isPending || isCommitting;

  const propIdsKey = React.useMemo(
    () => activeEmpresas.map((e) => e.id).sort().join(","),
    [activeEmpresas],
  );

  const [localIds, setLocalIds] = React.useState<string[]>(() =>
    activeEmpresas.map((e) => e.id),
  );
  const [dirty, setDirty] = React.useState(false);

  // Sincroniza local com prop APENAS quando:
  //   - não há mudança pendente (dirty=false), E
  //   - não há commit em curso (isBusy=false)
  // Isso evita o bug antigo em que `dirty` era zerado antes do refresh
  // chegar, e o effect sobrescrevia localIds com o valor antigo do
  // servidor, causando "checkboxes que voltam".
  React.useEffect(() => {
    if (!dirty && !isBusy) {
      setLocalIds(activeEmpresas.map((e) => e.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propIdsKey, dirty, isBusy]);

  const handleSelectionChange = React.useCallback((ids: string[]) => {
    setLocalIds(ids);
    setDirty(true);
  }, []);

  const handleOpenChange = React.useCallback(
    async (open: boolean) => {
      if (open || !dirty) return;

      // Liga o feedback visual IMEDIATAMENTE — antes de qualquer await —
      // pra não haver janela cega entre o clique de fechar e a chamada
      // do server action começar a responder.
      setIsCommitting(true);

      try {
        await setActiveEmpresas(localIds);
      } catch (err) {
        console.error("[empresa-filter.commit]", err);
        setLocalIds(activeEmpresas.map((e) => e.id));
        setDirty(false);
        setIsCommitting(false);
        return;
      }

      // Cookie gravado. Agora dispara o refresh dentro de useTransition
      // (isPending assume a barra a partir daqui) e libera o
      // isCommitting — a barra continua visível via isBusy (isPending
      // ainda true) até o servidor terminar.
      startTransition(() => {
        router.refresh();
      });
      setIsCommitting(false);
      // dirty continua true — vai ser zerado pelo useEffect abaixo
      // quando o prop finalmente refletir localIds E isBusy virar false.
    },
    [dirty, localIds, router, activeEmpresas],
  );

  // Quando o servidor terminou de processar E a prop bate com nosso
  // estado local, zera dirty. Aí o effect de sync volta a agir
  // normalmente (importante pra pegar mudanças de outra aba).
  React.useEffect(() => {
    if (!dirty || isBusy) return;
    const localKey = [...localIds].sort().join(",");
    if (localKey === propIdsKey) {
      setDirty(false);
    }
  }, [dirty, isBusy, localIds, propIdsKey]);

  return (
    <>
      <MultiSelectEmpresas
        empresas={empresas}
        selecionadas={localIds}
        onSelectionChange={handleSelectionChange}
        onOpenChange={handleOpenChange}
      />
      <RefreshFeedback active={isBusy} />
    </>
  );
}

/**
 * Feedback visual global durante o refresh:
 *   - Barra de progresso animada fixa no topo (portal → body).
 *   - Cursor "wait" no <html> pra deixar claro que a página está
 *     processando.
 *
 * Ambos somem quando isPending volta a false.
 */
function RefreshFeedback({ active }: { active: boolean }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const prev = html.style.cursor;
    html.style.cursor = "progress";
    return () => {
      html.style.cursor = prev;
    };
  }, [active]);

  if (!mounted || !active) return null;

  return createPortal(
    <div
      aria-live="polite"
      aria-label="Atualizando"
      className="fixed top-0 left-0 right-0 z-[100] h-0.5 overflow-hidden pointer-events-none"
    >
      <div className="h-full bg-california-red animate-progress-bar" />
    </div>,
    document.body,
  );
}
