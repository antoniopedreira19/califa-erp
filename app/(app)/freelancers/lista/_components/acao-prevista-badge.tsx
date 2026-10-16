import { cn } from "@/lib/utils";
import type { AcaoPrevistaFreelancer } from "@/lib/types";

type Variant = {
  label: string;
  wrap: string;
  dot: string;
};

const VARIANTES: Record<AcaoPrevistaFreelancer, Variant> = {
  contratar: {
    label: "Contratar",
    wrap: "bg-sky-50 text-sky-700 ring-sky-600/20",
    dot: "bg-sky-500",
  },
  renovar: {
    label: "Renovar",
    wrap: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    dot: "bg-emerald-500",
  },
  manter: {
    label: "Manter",
    wrap: "bg-violet-50 text-violet-700 ring-violet-600/20",
    dot: "bg-violet-500",
  },
  substituir: {
    label: "Substituir",
    wrap: "bg-amber-50 text-amber-700 ring-amber-600/20",
    dot: "bg-amber-500",
  },
  encerrar: {
    label: "Encerrar",
    wrap: "bg-california-red/10 text-california-red ring-california-red/25",
    dot: "bg-california-red",
  },
};

const SEM_DECISAO: Variant = {
  label: "Sem decisão",
  wrap: "bg-zinc-100 text-zinc-500 ring-zinc-300/60",
  dot: "bg-zinc-400",
};

export function AcaoPrevistaBadge({
  acao,
}: {
  acao: AcaoPrevistaFreelancer | null;
}) {
  const v = acao ? VARIANTES[acao] : SEM_DECISAO;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ring-1 ring-inset whitespace-nowrap",
        v.wrap,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", v.dot)} />
      {v.label}
    </span>
  );
}

export const ACOES_PREVISTAS: Array<{
  value: AcaoPrevistaFreelancer | "sem_decisao";
  label: string;
}> = [
  { value: "contratar", label: "Contratar" },
  { value: "renovar", label: "Renovar" },
  { value: "manter", label: "Manter" },
  { value: "substituir", label: "Substituir" },
  { value: "encerrar", label: "Encerrar" },
  { value: "sem_decisao", label: "Sem decisão" },
];
