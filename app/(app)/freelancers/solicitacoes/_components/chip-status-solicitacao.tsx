import { cn } from "@/lib/utils";
import type { FreelancerSolicitacaoStatus } from "@/lib/types";

const VARIANTES: Record<
  FreelancerSolicitacaoStatus,
  { label: string; wrap: string; dot: string; pulse?: boolean }
> = {
  pendente: {
    label: "Pendente",
    wrap: "bg-amber-50 text-amber-700 ring-amber-600/20",
    dot: "bg-amber-500",
    pulse: true,
  },
  aprovada: {
    label: "Aprovada",
    wrap: "bg-sky-50 text-sky-700 ring-sky-600/20",
    dot: "bg-sky-500",
  },
  cadastrada: {
    label: "Cadastrada",
    wrap: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    dot: "bg-emerald-500",
  },
  rejeitada: {
    label: "Rejeitada",
    wrap: "bg-california-red/10 text-california-red ring-california-red/25",
    dot: "bg-california-red",
  },
  cancelada: {
    label: "Cancelada",
    wrap: "bg-zinc-100 text-zinc-500 ring-zinc-300/60",
    dot: "bg-zinc-400",
  },
};

export function ChipStatusSolicitacao({
  status,
}: {
  status: FreelancerSolicitacaoStatus;
}) {
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
          v.pulse && "animate-pulse",
        )}
      />
      {v.label}
    </span>
  );
}

export const STATUS_SOLICITACAO: Array<{
  value: FreelancerSolicitacaoStatus;
  label: string;
}> = [
  { value: "pendente", label: "Pendente" },
  { value: "aprovada", label: "Aprovada" },
  { value: "cadastrada", label: "Cadastrada" },
  { value: "rejeitada", label: "Rejeitada" },
  { value: "cancelada", label: "Cancelada" },
];
