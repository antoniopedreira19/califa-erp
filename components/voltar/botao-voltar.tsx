"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  anotarVoltar,
  calcularVoltar,
  inscrever,
  saidaSegurada,
  type Voltar,
} from "./estado";

/**
 * O destino do voltar desta página, sempre em dia com o rastro, e o clique
 * que leva até ele. Serve ao `BotaoVoltar` e a quem precisa do mesmo destino
 * com outra cara (a barra da revisão da abertura) ou depois de uma ação
 * (excluir e voltar).
 *
 * `reserva` é para onde voltar quando não há página anterior no rastro, ou
 * quando a anterior é a Home: o voltar fixo que a tela sempre teve.
 */
export function useVoltar(reserva: string) {
  const router = useRouter();
  // No servidor e no primeiro render não há rastro: vale a reserva, e o
  // efeito troca pelo destino de verdade logo depois.
  const [voltar, setVoltar] = React.useState<Voltar>(() => ({
    href: reserva,
    indice: null,
    titulo: "Voltar",
  }));

  React.useEffect(() => {
    const atualizar = () => setVoltar(calcularVoltar(reserva));
    atualizar();
    return inscrever(atualizar);
  }, [reserva]);

  /** Vai ao destino calculado agora, e não ao do último render. */
  const irVoltar = React.useCallback(() => {
    const destino = calcularVoltar(reserva);
    anotarVoltar(destino.indice);
    if (saidaSegurada(destino.href)) return;
    router.push(destino.href);
  }, [reserva, router]);

  return { ...voltar, irVoltar };
}

/**
 * Botão Voltar do ERP — decisão 108, design A2 escolhido pelo Tiago em
 * 27/09/2026: botão contornado com "Voltar", sem o destino escrito; o
 * destino aparece num balão escuro ao passar o mouse ou focar pelo teclado.
 *
 * Leva à página anterior (regras em `lib/voltar.ts`). É um link de verdade:
 * clique com ctrl/cmd ou com o botão do meio abre o destino em outra aba,
 * como qualquer link.
 *
 * `variante="faixa"` é a versão de 32 px que mora na faixa do projeto.
 */
export function BotaoVoltar({
  reserva,
  variante = "pagina",
  className,
}: {
  reserva: string;
  variante?: "pagina" | "faixa";
  className?: string;
}) {
  const { href, titulo, irVoltar } = useVoltar(reserva);

  function aoClicar(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    irVoltar();
  }

  return (
    <Link
      href={href}
      prefetch={false}
      onClick={aoClicar}
      aria-label={titulo}
      className={cn(
        "group relative inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-md border border-border bg-white font-semibold text-foreground transition-colors hover:border-california-red/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        variante === "pagina" ? "h-9 pl-3 pr-3.5 text-sm shadow-soft" : "h-8 pl-2.5 pr-3 text-[13px]",
        className,
      )}
    >
      <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none" />
      Voltar
      <span
        aria-hidden
        className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-california-dark px-2.5 py-1.5 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-hover:delay-150 group-focus-visible:opacity-100 motion-reduce:transition-none"
      >
        {titulo}
      </span>
    </Link>
  );
}
