"use client";

import * as React from "react";
import { ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { buscarCidades } from "./abertura-actions";

export interface CidadeOption {
  id: string;
  nome: string;
}

/**
 * Combobox de cidade com busca no servidor.
 *
 * O cadastro comporta a lista completa do Brasil, então a busca NÃO pode
 * ser feita no cliente: a cada pausa na digitação consultamos o banco e
 * trazemos só os primeiros resultados.
 */
export function CidadeCombobox({
  value,
  onChange,
  iniciais,
  erro,
}: {
  value: CidadeOption | null;
  onChange: (cidade: CidadeOption) => void;
  /** Primeiras opções, carregadas no servidor — evita lista vazia ao abrir. */
  iniciais: CidadeOption[];
  erro?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [termo, setTermo] = React.useState("");
  const [opcoes, setOpcoes] = React.useState<CidadeOption[]>(iniciais);
  const [buscando, setBuscando] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    // Sem termo, mostra as iniciais que já vieram do servidor.
    if (termo.trim().length === 0) {
      setOpcoes(iniciais);
      setBuscando(false);
      return;
    }
    let cancelado = false;
    setBuscando(true);
    const t = setTimeout(async () => {
      const res = await buscarCidades(termo);
      if (cancelado) return;
      setOpcoes(res);
      setBuscando(false);
    }, 250);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [termo, open, iniciais]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTermo("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3.5 text-sm font-medium transition-colors",
            erro
              ? "border-california-red ring-2 ring-california-red/15"
              : "border-border hover:border-california-red/40",
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              value ? "text-foreground" : "font-normal text-muted-foreground",
            )}
          >
            {value?.nome ?? "Selecione a cidade"}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-2">
        <div className="flex h-9 items-center gap-2 rounded-lg border border-border px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar cidade…"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="mt-1.5 max-h-52 overflow-y-auto">
          {buscando ? (
            <p className="px-2.5 py-3 text-xs text-muted-foreground">Buscando…</p>
          ) : opcoes.length === 0 ? (
            <p className="px-2.5 py-3 text-xs text-muted-foreground">
              Nenhuma cidade encontrada.
            </p>
          ) : (
            opcoes.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                  setTermo("");
                }}
                className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13.5px] font-medium text-foreground hover:bg-muted transition-colors"
              >
                {c.nome}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
