"use client";

import * as React from "react";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { format, parse, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

/**
 * DatePicker — Popover + Calendar composto para uso em formulários.
 *
 * Guarda internamente um Date (ou null) e expõe um <input type="hidden">
 * com o valor no formato "YYYY-MM-DD" pro FormData ler. Isso mantém
 * compatibilidade com Server Actions que usam FormData e com colunas
 * `date` do Postgres.
 *
 * Uso:
 *   <DatePicker name="data_inicio_prevista" defaultValue="2026-08-01" />
 */
export interface DatePickerProps {
  name: string;
  /** Valor inicial em ISO "YYYY-MM-DD" ou vazio. */
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** Callback opcional recebendo a data selecionada (Date ou null). */
  onDateChange?: (date: Date | null) => void;
}

function parseIsoDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const parsed = parse(iso, "yyyy-MM-dd", new Date());
  return isValid(parsed) ? parsed : null;
}

function toIso(date: Date | null): string {
  return date ? format(date, "yyyy-MM-dd") : "";
}

export function DatePicker({
  name,
  defaultValue,
  placeholder = "Selecione a data",
  required,
  disabled,
  className,
  onDateChange,
}: DatePickerProps) {
  const [date, setDate] = React.useState<Date | null>(() => parseIsoDate(defaultValue));
  const [open, setOpen] = React.useState(false);

  function handleSelect(selected: Date | undefined) {
    const next = selected ?? null;
    setDate(next);
    onDateChange?.(next);
    if (next) setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDate(null);
    onDateChange?.(null);
  }

  const displayLabel = date
    ? format(date, "dd/MM/yyyy", { locale: ptBR })
    : placeholder;

  return (
    <>
      <input
        type="hidden"
        name={name}
        value={toIso(date)}
        required={required}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "group flex h-11 w-full items-center justify-between rounded-lg border border-border bg-white px-3.5 py-2 text-sm transition-colors hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15 disabled:cursor-not-allowed disabled:opacity-50",
              !date && "text-muted-foreground/70",
              date && "text-foreground",
              className,
            )}
          >
            <span className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 opacity-60" />
              {displayLabel}
            </span>
            {date && !disabled && (
              <span
                onClick={handleClear}
                role="button"
                aria-label="Limpar data"
                className="ml-2 rounded p-0.5 text-muted-foreground/60 hover:text-california-red hover:bg-accent transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[300px] p-0"
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={16}
        >
          <Calendar
            mode="single"
            selected={date ?? undefined}
            onSelect={handleSelect}
            initialFocus
            fixedWeeks
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
