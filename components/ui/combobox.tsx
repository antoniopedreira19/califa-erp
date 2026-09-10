"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ComboboxItem {
  value: string;
  label: string;
  /**
   * Segunda linha da opção, e ela também entra na busca. No campo de
   * fornecedor é o CPF/CNPJ — é o que separa homônimos e o que a produção
   * digita quando não lembra o nome exato (09/09/2026).
   */
  descricao?: string;
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
  /** Texto do campo de busca dentro do popover. */
  buscaPlaceholder?: string;
  /**
   * Habilita o ✕ dentro do campo, que zera a escolha. Sem isso não há
   * como voltar ao estado vazio depois de escolher — que é o que devolve
   * o "+" de cadastrar ao lado do campo da PP.
   */
  limpavel?: boolean;
  /**
   * O rodapé que aparece quando a busca não acha ninguém: "Cadastrar
   * «texto» …". Recebe o que foi digitado, para quem abrir o cadastro já
   * começar com o nome preenchido.
   */
  acaoSemResultado?: {
    rotulo: (busca: string) => string;
    onClick: (busca: string) => void;
  };
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
  buscaPlaceholder = "Buscar...",
  limpavel,
  acaoSemResultado,
}: ComboboxProps) {
  const listaId = React.useId();
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

  /** Sem acento e em minúsculas: "cenografia" acha "Cenografia Vértice". */
  const normalizar = (texto: string) =>
    texto
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const filtered = React.useMemo(() => {
    const q = normalizar(query.trim());
    if (!q) return items;
    return items.filter(
      (i) =>
        normalizar(i.label).includes(q) ||
        (i.descricao ? normalizar(i.descricao).includes(q) : false),
    );
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
      {/* O gatilho é `role="combobox"` e precisa apontar para a lista que
          abre — o leitor de tela anuncia o campo pelo que ele controla. */}
      <Popover open={open} onOpenChange={aoAbrirOuFechar} modal={dentroDeDialog}>
        <PopoverTrigger asChild>
          <button
            ref={gatilhoRef}
            type="button"
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listaId}
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
            {/* Zerar a escolha sem abrir a lista. Vai como <span> porque o
                gatilho já é um <button> e um botão dentro de outro é HTML
                inválido — o clique é interceptado antes de abrir o popover. */}
            {limpavel && selected && !disabled && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Limpar seleção"
                title="Limpar seleção"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onChange(null);
                  }
                }}
                className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors hover:bg-california-red/10 hover:text-california-red"
              >
                <X className="h-3 w-3" />
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
          <div className="border-b border-border p-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={buscaPlaceholder}
              className="h-9"
            />
          </div>
          <div id={listaId} role="listbox" className="max-h-64 overflow-y-auto py-1">
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
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{item.label}</span>
                  {item.descricao && (
                    <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                      {item.descricao}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>

          {/* Busca sem resultado não é beco: daqui se cadastra, já com o
              que foi digitado (desenho "PP - Campo Fornecedor"). */}
          {acaoSemResultado && filtered.length === 0 && query.trim().length > 1 && (
            <button
              type="button"
              onClick={() => {
                const termo = query.trim();
                setOpen(false);
                setQuery("");
                acaoSemResultado.onClick(termo);
              }}
              className="flex w-full items-center gap-2 border-t border-border bg-muted/30 px-3 py-2.5 text-left text-[12.5px] font-semibold text-california-red hover:bg-california-red/[0.06]"
            >
              <Plus className="h-3.5 w-3.5 flex-none" />
              <span className="truncate">{acaoSemResultado.rotulo(query.trim())}</span>
            </button>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
