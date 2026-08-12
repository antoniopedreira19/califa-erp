"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, FileText, Files, Plus } from "lucide-react";

interface Props {
  projetoId: string;
}

/**
 * Duas portas de entrada para o mesmo destino — um orçamento de job.
 *
 * - "de um job" leva ao formulário de sempre e cria um orçamento por vez.
 * - "do projeto" abre o editor multi-jobs, onde vários orçamentos são
 *   montados juntos e gravados de uma vez.
 *
 * O menu é feito à mão (sem Radix) porque o botão precisa continuar sendo
 * a âncora vermelha do cabeçalho: um DropdownMenu traria trigger próprio
 * e um conjunto de estilos que teria de ser desfeito peça por peça.
 */
export function NovoOrcamentoMenu({ projetoId }: Props) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const ancoraRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!aberto) return;

    function onMouseDown(e: MouseEvent) {
      if (!ancoraRef.current?.contains(e.target as Node)) setAberto(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [aberto]);

  function navegar(destino: string) {
    setAberto(false);
    router.push(destino);
  }

  return (
    <div ref={ancoraRef} className="relative flex-none">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover transition-all"
      >
        <Plus className="h-4 w-4" />
        Novo orçamento
        <ChevronDown className="h-3.5 w-3.5 opacity-80" />
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.625rem)] z-20 w-[292px] rounded-2xl border border-border bg-card p-1.5 text-left shadow-elevated"
        >
          <OpcaoMenu
            icone={<FileText className="h-4 w-4 text-muted-foreground" />}
            rotulo="Criar orçamento de um job"
            onClick={() => navegar(`/orcamentos/${projetoId}/novo`)}
          />
          {/* Divisória entre as duas portas de entrada — recuada até o texto,
              para não cortar a coluna dos ícones. */}
          <div className="mx-3 h-px bg-border" role="separator" />
          <OpcaoMenu
            icone={<Files className="h-4 w-4 text-muted-foreground" />}
            rotulo="Criar orçamento do projeto"
            onClick={() => navegar(`/orcamentos/${projetoId}/multi`)}
          />
        </div>
      )}
    </div>
  );
}

function OpcaoMenu({
  icone,
  rotulo,
  onClick,
}: {
  icone: React.ReactNode;
  rotulo: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent"
    >
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-muted">
        {icone}
      </span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
        {rotulo}
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
    </button>
  );
}
