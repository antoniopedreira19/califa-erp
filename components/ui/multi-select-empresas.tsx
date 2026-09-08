"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import type { Empresa } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type MultiSelectEmpresasProps = {
  empresas: Empresa[];
  selecionadas: string[];
  onSelectionChange: (ids: string[]) => void;
  /**
   * Chamado quando o Popover abre/fecha. Útil pra consumidores que
   * batch-commitam mudanças no fechamento (ver PageHeaderEmpresaFilter).
   */
  onOpenChange?: (open: boolean) => void;
};

/**
 * Multi-select de empresas. Popover com checkbox por linha.
 * Regra do trigger:
 *   - 0 selecionadas OU todas selecionadas → "Todas as empresas"
 *   - 1 selecionada → nome_fantasia ?? razao_social
 *   - N (< total) selecionadas → "N selecionadas"
 *
 * Marcar todas / Limpar: atalhos no topo do dropdown.
 */
export function MultiSelectEmpresas(props: MultiSelectEmpresasProps) {
  const { empresas, selecionadas, onSelectionChange, onOpenChange } = props;

  const total = empresas.length;
  const selCount = selecionadas.length;
  const todasMarcadas = selCount === 0 || selCount === total;

  const labelTrigger = React.useMemo(() => {
    if (todasMarcadas) return "Todas as empresas";
    if (selCount === 1) {
      const e = empresas.find((x) => x.id === selecionadas[0]);
      return e ? (e.nome_fantasia ?? e.razao_social) : "1 selecionada";
    }
    return `${selCount} selecionadas`;
  }, [empresas, selecionadas, selCount, todasMarcadas]);

  // Marcar todas e limpar têm o mesmo efeito prático (0 = todas).
  // Dois botões visualmente pro operador ler o que está fazendo.
  const marcarTodas = () => onSelectionChange([]);
  const limpar = () => onSelectionChange([]);

  const toggleEmpresa = (id: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selecionadas, id]);
    } else {
      onSelectionChange(selecionadas.filter((s) => s !== id));
    }
  };

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="justify-between min-w-[180px] font-normal"
        >
          <span className="truncate">{labelTrigger}</span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <Button variant="ghost" size="sm" onClick={marcarTodas} className="flex-1 text-xs">
            Marcar todas
          </Button>
          <Button variant="ghost" size="sm" onClick={limpar} className="flex-1 text-xs">
            Limpar
          </Button>
        </div>
        <div className="pt-2 space-y-1 max-h-72 overflow-y-auto">
          {empresas.map((e) => {
            const checked = selecionadas.includes(e.id);
            return (
              <label
                key={e.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(state) => toggleEmpresa(e.id, state === true)}
                />
                <span className="text-sm truncate">
                  {e.nome_fantasia ?? e.razao_social}
                </span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
