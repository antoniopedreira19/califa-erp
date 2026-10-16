import { cn } from "@/lib/utils";
import type { StatusCalculado } from "@/lib/types";

interface Variant {
  label: string;
  wrap: string;
  dot: string;
  /** Deixa a bolinha pulsando — pra "vigente/ativo" fica mais vivo. */
  pulsing?: boolean;
}

const VARIANTES: Record<StatusCalculado, Variant> = {
  regular: {
    label: "Regular",
    wrap: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    dot: "bg-emerald-500",
    pulsing: true,
  },
  vencendo: {
    label: "Vencendo",
    wrap: "bg-amber-50 text-amber-700 ring-amber-600/20",
    dot: "bg-amber-500",
  },
  agendado: {
    label: "Agendado",
    wrap: "bg-violet-50 text-violet-700 ring-violet-600/20",
    dot: "bg-violet-500",
  },
  irregular: {
    label: "Irregular",
    wrap: "bg-california-red/10 text-california-red ring-california-red/25",
    dot: "bg-california-red",
  },
  sem_minuta: {
    label: "Sem minuta",
    wrap: "bg-california-red/10 text-california-red ring-california-red/25",
    dot: "bg-california-red",
  },
  sem_assinado: {
    label: "Sem assinado",
    wrap: "bg-california-red/10 text-california-red ring-california-red/25",
    dot: "bg-california-red",
  },
  pendente: {
    label: "Pendente",
    wrap: "bg-sky-50 text-sky-700 ring-sky-600/20",
    dot: "bg-sky-500",
  },
  encerrado: {
    label: "Encerrado",
    wrap: "bg-zinc-100 text-zinc-500 ring-zinc-300/60",
    dot: "bg-zinc-400",
  },
  limbo: {
    label: "Limbo",
    wrap: "bg-zinc-100 text-zinc-500 ring-zinc-300/60",
    dot: "bg-zinc-400",
  },
};

export function StatusBadge({ status }: { status: StatusCalculado }) {
  const v = VARIANTES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ring-1 ring-inset whitespace-nowrap",
        v.wrap,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full shrink-0",
          v.dot,
          v.pulsing && "animate-pulse",
        )}
      />
      {v.label}
    </span>
  );
}

export const STATUS_FILTRAVEIS: StatusCalculado[] = [
  "regular",
  "vencendo",
  "irregular",
  "sem_minuta",
  "sem_assinado",
  "agendado",
  "pendente",
  "encerrado",
];

export const STATUS_LABEL: Record<StatusCalculado, string> = {
  regular: "Regular",
  vencendo: "Vencendo",
  irregular: "Irregular",
  sem_minuta: "Sem minuta",
  sem_assinado: "Sem assinado",
  agendado: "Agendado",
  pendente: "Pendente",
  encerrado: "Encerrado",
  limbo: "Limbo",
};
