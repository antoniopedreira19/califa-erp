"use client";

import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface MultiSelectItem {
  value: string;
  label: string;
}

interface MultiSelectProps {
  items: ReadonlyArray<MultiSelectItem>;
  /** Ordem importa: o primeiro selecionado é gravado nas colunas de
   *  compatibilidade (`projetos.regional_id`, `projetos.responsavel_id`). */
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  /** Texto do rodapé quando a lista de opções está vazia. */
  vazio?: string;
  /** Valores que NÃO podem ser removidos: o chip vem sem o "x" e a opção
   *  não desmarca na lista. Serve à Equipe do projeto, onde criador, GPs
   *  e produtores entram por direito e não saem na mão (02/09/2026). */
  travados?: ReadonlyArray<string>;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * Seleção múltipla no padrão visual do `Combobox`: gatilho com a mesma
 * altura de um `SelectTrigger`, busca no topo e chips removíveis dentro
 * do próprio gatilho.
 *
 * Não emite `<input hidden>`: quem usa monta o FormData com os ids na
 * ordem em que foram escolhidos.
 */
export function MultiSelect({
  items,
  value,
  onChange,
  placeholder = "Selecione...",
  vazio = "Nenhuma opção disponível.",
  travados,
  disabled,
  className,
  id,
}: MultiSelectProps) {
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

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q));
  }, [items, query]);

  const selecionados = React.useMemo(
    () =>
      value
        .map((v) => items.find((i) => i.value === v))
        .filter((i): i is MultiSelectItem => Boolean(i)),
    [items, value],
  );

  const travadosSet = React.useMemo(
    () => new Set(travados ?? []),
    [travados],
  );

  function alternar(v: string) {
    // Travado não sai — nem pelo chip nem pela lista.
    if (travadosSet.has(v) && value.includes(v)) return;
    onChange(
      value.includes(v) ? value.filter((x) => x !== v) : [...value, v],
    );
  }

  return (
    /* `modal` só quando o campo está dentro de um diálogo.

       O Radix Dialog trava a rolagem com react-remove-scroll e libera
       apenas o próprio conteúdo (via `shards`). Como o popover é portalado
       no `body`, ele fica FORA dessa área liberada: a roda do mouse era
       cancelada e só restava arrastar a barra da lista. Popover modal
       empilha o próprio lock, que passa a ser o do topo — o lock do
       diálogo se cala e a lista volta a rolar (31/08/2026).

       Fora de diálogo o modal NÃO entra: ali ele travaria a rolagem da
       página inteira e deslocaria o layout ao compensar a barra. É o caso
       dos filtros dos relatórios, que usam este mesmo componente solto na
       página. */
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
            "flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-white px-3 py-1.5 text-sm ring-offset-background",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          {selecionados.length === 0 ? (
            <span className="truncate text-left text-muted-foreground">
              {placeholder}
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-1 py-0.5 text-left">
              {selecionados.map((s) => (
                <span
                  key={s.value}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium"
                >
                  {s.label}
                  {/* <span> e não <button>: o gatilho já é um botão e
                      HTML não permite botão aninhado. Chip travado não
                      ganha o "x": oferecer um botão que não faz nada é
                      pior do que não oferecer. */}
                  {!travadosSet.has(s.value) && (
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={`Remover ${s.label}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        alternar(s.value);
                      }}
                      className="text-muted-foreground hover:text-california-red"
                    >
                      <X className="h-3 w-3" />
                    </span>
                  )}
                </span>
              ))}
            </span>
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        avoidCollisions={false}
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        {items.length > 8 && (
          <div className="border-b border-border p-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar..."
              className="h-9"
            />
          </div>
        )}
        <div className="max-h-64 overflow-y-auto py-1">
          {items.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">{vazio}</p>
          )}
          {items.length > 0 && filtered.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Nenhum resultado.
            </p>
          )}
          {filtered.map((item) => {
            const marcado = value.includes(item.value);
            return (
              <button
                type="button"
                key={item.value}
                onClick={() => alternar(item.value)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent",
                  marcado && "bg-accent/50",
                )}
              >
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    marcado ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
