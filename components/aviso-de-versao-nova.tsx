"use client";

/**
 * "O sistema foi atualizado" — aviso no topo da tela quando sai versão nova
 * (09/10/2026).
 *
 * A proteção de versão da Vercel prende cada aba à publicação em que ela
 * abriu, server actions incluídas: quem não recarrega segue com o código
 * antigo. Naquele dia uma GP ficou duas horas no mesmo pop-up e tentou de
 * novo, numa aba de antes do deploy, um cadastro que a correção já resolvia.
 *
 * A aba pergunta a /api/versao — que sempre responde da publicação mais
 * nova — a cada 5 minutos com a aba à vista e toda vez que a pessoa volta
 * para ela. Versão diferente da dela: o aviso aparece e fica até recarregar.
 * Nunca recarrega sozinho, para não perder o que está sendo preenchido.
 *
 * Fica por cima de diálogos e da tela cheia (`z-[80]`: diálogos vão de 50 a
 * 60, popovers e selects ficam em 70), e o clique nele não chega ao diálogo
 * aberto, que fecharia.
 */

import * as React from "react";
import { RefreshCw } from "lucide-react";

/** A versão desta aba, fixada no build (`next.config.js`). */
const VERSAO_DESTA_ABA = process.env.VERSAO_DO_SISTEMA ?? "local";
const INTERVALO_MS = 5 * 60 * 1000;

export function AvisoDeVersaoNova() {
  const [desatualizada, setDesatualizada] = React.useState(false);

  React.useEffect(() => {
    // Em desenvolvimento não há publicação para comparar.
    if (VERSAO_DESTA_ABA === "local") return;
    let encerrado = false;

    async function conferir() {
      if (encerrado || document.hidden) return;
      try {
        const r = await fetch("/api/versao", { cache: "no-store" });
        if (!r.ok) return;
        const { versao } = (await r.json()) as { versao?: string };
        if (!encerrado && versao && versao !== VERSAO_DESTA_ABA) {
          encerrado = true;
          setDesatualizada(true);
        }
      } catch {
        // Sem rede: confere de novo na próxima vez.
      }
    }

    const intervalo = window.setInterval(conferir, INTERVALO_MS);
    const aoVoltar = () => {
      if (!document.hidden) void conferir();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    return () => {
      encerrado = true;
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
    };
  }, []);

  // O diálogo do Radix fecha com o `pointerdown` fora dele, ouvido no
  // `document` — onde o React também ouve, e por isso o `stopPropagation`
  // do React não o alcança (o clique no texto do aviso fechava o pop-up da
  // PP). Na captura da `window` o evento para antes de chegar lá.
  const caixaRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!desatualizada) return;
    const segurar = (e: PointerEvent) => {
      if (caixaRef.current?.contains(e.target as Node)) e.stopPropagation();
    };
    window.addEventListener("pointerdown", segurar, true);
    return () => window.removeEventListener("pointerdown", segurar, true);
  }, [desatualizada]);

  if (!desatualizada) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex justify-center px-4">
      <div
        ref={caixaRef}
        role="status"
        className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full bg-california-dark py-1.5 pl-4 pr-1.5 text-[13px] text-white shadow-lg"
      >
        <span className="min-w-0">
          O sistema foi atualizado. Salve o que estiver fazendo e recarregue a
          página.
        </span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex flex-none items-center gap-1.5 rounded-full bg-california-red px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-california-red-hover"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Recarregar
        </button>
      </div>
    </div>
  );
}
