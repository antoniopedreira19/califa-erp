"use client";

/**
 * O atalho de CNPJ da aba Apuração (decisão 181, pedido do Tiago em
 * 16/10/2026): o mesmo desenho do `MultiSelectRegionais` da aba PPs do
 * Contas a Pagar — popover com uma caixa por PJ, "Marcar todos" e "Limpar",
 * e o filtro vale a cada clique, sem "Aplicar". Vazio = todos.
 */

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface CnpjDoFiltro {
  /** A PJ (empresa contábil). */
  id: string;
  nome: string;
  /** O CNPJ da matriz, formatado. */
  cnpj: string;
}

export function MultiSelectCnpjs({
  opcoes,
  selecionados,
  onSelectionChange,
}: {
  opcoes: CnpjDoFiltro[];
  selecionados: string[];
  onSelectionChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const n = selecionados.length;
  const todos = n === 0 || n === opcoes.length;
  const rotulo = todos
    ? "Todos os CNPJs"
    : n === 1
      ? opcoes.find((o) => o.id === selecionados[0])?.nome ?? "1 selecionado"
      : `${n} selecionados`;

  function alternar(id: string, marcado: boolean) {
    onSelectionChange(marcado ? [...selecionados, id] : selecionados.filter((s) => s !== id));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-label="Filtrar por CNPJ" className="h-9 w-[190px] justify-between px-3 text-sm font-normal">
          <span className="truncate">{rotulo}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Button variant="ghost" size="sm" onClick={() => onSelectionChange([])} className="flex-1 text-xs">
            Marcar todos
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onSelectionChange([])} className="flex-1 text-xs">
            Limpar
          </Button>
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto pt-2">
          {opcoes.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
              <Checkbox checked={selecionados.includes(o.id)} onCheckedChange={(v) => alternar(o.id, v === true)} />
              <span className="min-w-0">
                <span className="block truncate text-sm">{o.nome}</span>
                <span className="block font-mono text-[11px] text-muted-foreground">{o.cnpj}</span>
              </span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
