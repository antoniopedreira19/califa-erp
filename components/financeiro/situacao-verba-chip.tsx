import { cn } from "@/lib/utils";
import { situacaoVerbaLabel, type SituacaoVerba } from "@/lib/types";

/**
 * O chip da situação da verba depois de paga (decisão 081) — o mesmo na aba
 * de PPs do job, na aprovação e em Títulos a Pagar. "Aguardando prestação"
 * leva borda tracejada: é a única situação em que alguém deve algo e ainda
 * não fez nada.
 */
const CORES: Record<SituacaoVerba, string> = {
  aguardando_prestacao: "border-dashed border-amber-400 bg-amber-50 text-amber-800",
  prestacao_em_avaliacao: "border-yellow-200 bg-yellow-50 text-yellow-800",
  prestacao_reprovada: "border-california-red/30 bg-california-red/10 text-california-red",
  devolucao_pendente: "border-teal-200 bg-teal-50 text-teal-800",
  concluida: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

export function SituacaoVerbaChip({
  situacao,
  className,
}: {
  situacao: SituacaoVerba;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        CORES[situacao],
        className,
      )}
    >
      {situacaoVerbaLabel(situacao)}
    </span>
  );
}
