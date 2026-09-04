import { cn } from "@/lib/utils";
import { ppStatusLabel, type PPStatus } from "@/lib/types";

const CORES: Record<PPStatus, string> = {
  // Gerada é rascunho do job: neutra, para não parecer que já anda no
  // financeiro (02/09/2026).
  gerada: "border-[#d7d7d7] bg-[#f6f6f6] text-foreground",
  em_avaliacao: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]",
  aprovada: "border-blue-200 bg-blue-50 text-blue-700",
  pago: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejeitada: "border-red-200 bg-red-50 text-red-700",
  cancelada: "border-border bg-muted text-muted-foreground",
};

export function PPStatusChip({
  status,
  className,
}: {
  status: PPStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        CORES[status],
        className,
      )}
    >
      {ppStatusLabel(status)}
    </span>
  );
}
