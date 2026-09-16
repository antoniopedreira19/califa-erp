"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface RegionalOption {
  id: string;
  nome: string;
}

export interface MultiSelectRegionaisProps {
  regionais: RegionalOption[];
  /** Vazio = todas. É filtro de leitura, não permissão. */
  selecionadas: string[];
  onSelectionChange: (ids: string[]) => void;
  className?: string;
}

/**
 * Multi-select de regionais (16/09/2026, pedido do Tiago).
 *
 * Mesmo desenho do de empresas (`multi-select-empresas.tsx`): popover com
 * uma caixa por linha e os atalhos "Marcar todas" / "Limpar" no topo. O
 * rótulo do gatilho diz "Todas as regionais" quando nada (ou tudo) está
 * marcado, o nome quando é uma só, e "N selecionadas" no resto.
 *
 * Diferença proposital: aqui não existe "Aplicar". Este filtro é da lista
 * que já está na tela e vale a cada clique; o botão só existe no de
 * empresas porque lá a escolha vai ao servidor e recarrega a página.
 */
export function MultiSelectRegionais({
  regionais,
  selecionadas,
  onSelectionChange,
  className,
}: MultiSelectRegionaisProps) {
  const [open, setOpen] = React.useState(false);

  const total = regionais.length;
  const selCount = selecionadas.length;
  const todasMarcadas = selCount === 0 || selCount === total;

  const labelTrigger = React.useMemo(() => {
    if (todasMarcadas) return "Todas as regionais";
    if (selCount === 1) {
      return regionais.find((r) => r.id === selecionadas[0])?.nome ?? "1 selecionada";
    }
    return `${selCount} selecionadas`;
  }, [regionais, selecionadas, selCount, todasMarcadas]);

  function alternar(id: string, marcada: boolean) {
    onSelectionChange(
      marcada ? [...selecionadas, id] : selecionadas.filter((s) => s !== id),
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label="Filtrar por regional"
          className={className ?? "h-9 w-[190px] justify-between px-3 text-sm font-normal"}
        >
          <span className="truncate">{labelTrigger}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSelectionChange([])}
            className="flex-1 text-xs"
          >
            Marcar todas
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSelectionChange([])}
            className="flex-1 text-xs"
          >
            Limpar
          </Button>
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto pt-2">
          {regionais.map((r) => (
            <label
              key={r.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
            >
              <Checkbox
                checked={selecionadas.includes(r.id)}
                onCheckedChange={(estado) => alternar(r.id, estado === true)}
              />
              <span className="truncate text-sm">{r.nome}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
