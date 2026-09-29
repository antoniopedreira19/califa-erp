"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

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
        dropdown:
          "appearance-none rounded-lg border border-border bg-white pl-3 pr-8 py-1.5 text-sm font-medium text-foreground hover:border-california-red/40 focus:outline-none focus:border-california-red focus:ring-2 focus:ring-california-red/15 cursor-pointer transition-colors [background-image:url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e\")] bg-no-repeat bg-[position:right_0.5rem_center] bg-[length:1.25rem_1.25rem]",
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
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
