"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DropdownProps } from "react-day-picker";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * Substitui os <select> nativos que o react-day-picker renderiza no
 * modo captionLayout='dropdown'. Motivo: os nativos abrem no browser
 * padrão (subindo/ocupando tela toda com 96 anos), e não dá pra
 * controlar direção nem scroll via CSS. Radix Select resolve com
 * altura máxima + scroll interno + posição fixa pra baixo.
 */
function DropdownCalendario({ value, onChange, children }: DropdownProps) {
  const opcoes = React.Children.toArray(
    children,
  ) as React.ReactElement<React.OptionHTMLAttributes<HTMLOptionElement>>[];

  return (
    <Select
      value={value?.toString()}
      onValueChange={(v) => {
        onChange?.({
          target: { value: v },
        } as unknown as React.ChangeEvent<HTMLSelectElement>);
      }}
    >
      <SelectTrigger className="h-8 w-auto min-w-[110px] gap-1 border-border bg-white px-2.5 py-1 text-sm font-medium capitalize">
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        side="bottom"
        avoidCollisions={false}
        position="popper"
        sideOffset={4}
        className="max-h-[240px]"
      >
        {opcoes.map((opcao) => {
          const val = opcao.props.value?.toString() ?? "";
          return (
            <SelectItem key={val} value={val} className="capitalize">
              {opcao.props.children}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout,
  ...props
}: CalendarProps) {
  const usaDropdown =
    captionLayout === "dropdown" || captionLayout === "dropdown-buttons";
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      locale={ptBR}
      captionLayout={captionLayout}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-3",
        // Sem dropdowns: setas ficam absolutas nas bordas e a label
        // no meio. Com dropdowns: layout flex normal, sem setas, sem
        // label duplicada — os selects já mostram mês e ano.
        caption: usaDropdown
          ? "flex justify-center pt-1 pb-1 items-center"
          : "flex justify-center pt-1 relative items-center",
        caption_label: usaDropdown
          ? "hidden"
          : "text-sm font-semibold text-foreground capitalize",
        caption_dropdowns: "flex gap-2 items-center justify-center",
        // O <select> nativo do react-day-picker é substituído pelo
        // DropdownCalendario abaixo via `components`, então o className
        // do dropdown fica vazio (não é mais renderizado).
        dropdown: "",
        vhidden: "hidden",
        nav: usaDropdown ? "hidden" : "space-x-1 flex items-center",
        nav_button:
          "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-california-red hover:bg-accent transition-colors",
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell:
          "text-muted-foreground rounded-md w-9 font-normal text-[0.7rem] uppercase tracking-wider",
        row: "flex w-full mt-1",
        cell: "text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
        day: "h-9 w-9 p-0 font-normal rounded-md hover:bg-accent hover:text-california-red transition-colors aria-selected:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/40",
        day_selected:
          "bg-california-red text-white hover:bg-california-red-hover hover:text-white focus:bg-california-red focus:text-white",
        day_today: "border border-california-red/40",
        day_outside: "text-muted-foreground/40",
        day_disabled: "text-muted-foreground/40 opacity-50",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: () => <ChevronLeft className="h-4 w-4" />,
        IconRight: () => <ChevronRight className="h-4 w-4" />,
        ...(usaDropdown ? { Dropdown: DropdownCalendario } : {}),
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
