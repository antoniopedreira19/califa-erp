"use client";

/**
 * "Exportar" da Planilha Interna do job (decisão 088, 17/09/2026).
 *
 * Fica na barra da planilha, logo depois do "Exibir", e abre o mesmo
 * popover de confirmação do "Exportar esta versão?" do orçamento —
 * alinhado à direita, porque aqui o botão fica no fim da barra. O arquivo
 * sai de `/api/jobs/[jobId]/export`: orçado com as erratas, planejado e
 * realizado, com as PPs de cada item em sublinhas recolhíveis.
 */

import * as React from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  jobId: string;
  /** "JOB-0033" — o código, que também nomeia o arquivo. */
  codigo: string;
  /** Nome do job, como aparece no cabeçalho da planilha. */
  nome: string;
  qtdGrupos: number;
  qtdItens: number;
}

export function ExportarInternaButton({
  jobId,
  codigo,
  nome,
  qtdGrupos,
  qtdItens,
}: Props) {
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

  const resumo = `${qtdGrupos} ${qtdGrupos === 1 ? "grupo" : "grupos"} · ${qtdItens} ${
    qtdItens === 1 ? "item" : "itens"
  }`;

  return (
    <div ref={ancoraRef} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/30 hover:bg-california-red/[0.06]",
          aberto && "border-california-red/40 text-california-red",
        )}
      >
        <Download className="h-3.5 w-3.5 text-california-red" />
        Exportar
      </button>

      {aberto && (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-[340px] rounded-2xl border border-border bg-card p-4 text-left shadow-elevated">
          <div className="flex items-center gap-2">
            <span className="inline-flex min-w-8 items-center justify-center rounded-lg bg-california-red/10 px-1.5 py-1 font-mono text-[11.5px] font-bold text-california-red">
              xlsx
            </span>
            <p className="text-sm font-semibold text-foreground">
              Exportar a planilha interna do job?
            </p>
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            Orçado com as erratas, planejado e realizado de {codigo} · {nome} ·{" "}
            {resumo}, com as PPs de cada item em sublinhas que dá para recolher.
            O realizado sai na visão Líquido (− BV), a mesma da tela.
          </p>
          <div className="mt-3.5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancelar
            </button>
            <a
              href={`/api/jobs/${jobId}/export`}
              onClick={() => setAberto(false)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-california-red-hover"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar planilha
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
