"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ComboboxItem {
  value: string;
  label: string;
}

interface ComboboxProps {
  items: ReadonlyArray<ComboboxItem>;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
}

export function Combobox({
  items,
  value,
  onChange,
  placeholder = "Selecione...",
  disabled,
  className,
  id,
  name,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const gatilhoRef = React.useRef<HTMLButtonElement>(null);
  const [dentroDeDialog, setDentroDeDialog] = React.useState(false);

  /** Ver o comentário do `modal` no Popover, mais abaixo. */
  function aoAbrirOuFechar(proximo: boolean) {
    if (proximo) {
      setDentroDeDialog(
        Boolean(gatilhoRef.current?.closest('[role="dialog"]')),
      );
    }
    setOpen(proximo);
  }

  const selected = React.useMemo(
    () => items.find((i) => i.value === value) ?? null,
    [items, value],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <>
      {name && <input type="hidden" name={name} value={value ?? ""} />}
      {/* `modal` só quando o campo está dentro de um diálogo.

          O Radix Dialog trava a rolagem com react-remove-scroll e libera
          apenas o próprio conteúdo (via `shards`). Como o popover é
          portalado no `body`, ele fica FORA dessa área liberada: a roda do
          mouse era cancelada e só restava arrastar a barra da lista.
          Popover modal empilha o próprio lock, que passa a ser o do topo —
          o lock do diálogo se cala e a lista volta a rolar (31/08/2026).

          Fora de diálogo o modal NÃO entra: ali ele travaria a rolagem da
          página inteira e deslocaria o layout ao compensar a barra. É o
          caso do formulário de fornecedor, que roda solto na página. */}
      <Popover open={open} onOpenChange={aoAbrirOuFechar} modal={dentroDeDialog}>
        <PopoverTrigger asChild>
          <button
            ref={gatilhoRef}
            type="button"
            id={id}
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "flex h-10 w-full items-center justify-between rounded-lg border border-input bg-white px-3 py-2 text-sm ring-offset-background",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              className,
            )}
          >
            <span className={cn("truncate text-left", !selected && "text-muted-foreground")}>
              {selected ? selected.label : placeholder}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          avoidCollisions={false}
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
        >
          <div className="border-b border-border p-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar..."
              className="h-9"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum resultado.</p>
            )}
            {filtered.map((item) => (
              <button
                type="button"
                key={item.value}
                onClick={() => {
                  onChange(item.value);
                  setOpen(false);
                  setQuery("");
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent",
                  item.value === value && "bg-accent/50",
                )}
              >
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    item.value === value ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
