"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Barra de progresso fina no topo da janela durante navegações entre
 * rotas. Serve pra dar feedback imediato quando o usuário clica num
 * `<Link>` ou card e a página destino demora pra renderizar no server
 * (SSR do Next 14).
 *
 * Como funciona:
 *   1. Captura clicks em `<a href="...">` internos (mesma origem, sem
 *      target _blank e sem modifier keys). Mostra a barra começando em
 *      20% e sobe progressivamente até ~85%.
 *   2. Também captura `history.pushState` e `history.replaceState`
 *      (patching leve) pra pegar `router.push` programático.
 *   3. Esconde a barra quando `pathname` ou `searchParams` mudam —
 *      sinal de que a navegação terminou (o Next re-renderizou).
 *
 * Alternativa seria adicionar `nextjs-toploader` — evitamos a dep.
 */
export function TopProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [visible, setVisible] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const stop = React.useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setProgress(100);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 200);
  }, []);

  const start = React.useCallback(() => {
    // Já estava rodando (navegação encadeada): reseta e dispara de novo.
    if (timerRef.current) clearInterval(timerRef.current);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    setVisible(true);
    setProgress(15);
    let p = 15;
    timerRef.current = setInterval(() => {
      // Avanço sublinear: nunca chega em 100 sozinho, só quando a
      // navegação terminar (= quando o pathname/searchParams mudar).
      const resta = 85 - p;
      p = p + Math.max(0.5, resta * 0.08);
      setProgress(Math.min(p, 85));
    }, 200);
  }, []);

  // Captura cliques em links internos e navegações programáticas.
  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      // Apenas click esquerdo, sem modifier
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
        return;
      }
      if (e.defaultPrevented) return;
      const el = (e.target as HTMLElement | null)?.closest?.("a");
      if (!(el instanceof HTMLAnchorElement)) return;
      const href = el.getAttribute("href");
      if (!href) return;
      // Links externos, âncoras ou mailto: fora do escopo
      if (
        href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        el.target === "_blank" ||
        el.hasAttribute("download")
      ) {
        return;
      }
      // Se o href bate exatamente com a URL atual, não há navegação
      const atual = window.location.pathname + window.location.search;
      if (href === atual) return;
      start();
    }

    // Patch leve de history.pushState/replaceState pra pegar router.push
    const originalPush = history.pushState.bind(history);
    const originalReplace = history.replaceState.bind(history);
    history.pushState = (...args) => {
      start();
      return originalPush(...args);
    };
    history.replaceState = (...args) => {
      start();
      return originalReplace(...args);
    };

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      history.pushState = originalPush;
      history.replaceState = originalReplace;
    };
  }, [start]);

  // Fim de navegação: pathname ou searchParams mudaram → esconde.
  // (useEffect com essas deps só roda APÓS a renderização da nova rota.)
  React.useEffect(() => {
    if (visible) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()]);

  // Limpa timers no unmount
  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      role="progressbar"
      aria-label="Carregando página"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="pointer-events-none fixed left-0 top-0 z-[9999] h-0.5 w-full overflow-hidden bg-transparent"
    >
      <div
        className="h-full bg-california-red shadow-[0_0_8px_rgba(231,75,86,0.6)] transition-[width] duration-200 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
