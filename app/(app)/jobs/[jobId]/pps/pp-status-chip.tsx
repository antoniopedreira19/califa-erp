import { cn } from "@/lib/utils";
import { ppStatusLabel, type PPStatus } from "@/lib/types";

const CORES: Record<PPStatus, string> = {
  em_avaliacao: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]",
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
