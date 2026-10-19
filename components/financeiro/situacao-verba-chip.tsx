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

/** O rótulo longo em duas linhas equilibradas (null = cabe numa só). */
function emDuasLinhas(rotulo: string): [string, string] | null {
  const palavras = rotulo.split(" ");
  if (rotulo.length <= 14 || palavras.length < 2) return null;
  let melhor: [string, string] | null = null;
  for (let i = 1; i < palavras.length; i++) {
    const par: [string, string] = [palavras.slice(0, i).join(" "), palavras.slice(i).join(" ")];
    if (!melhor || Math.max(par[0].length, par[1].length) < Math.max(melhor[0].length, melhor[1].length)) {
      melhor = par;
    }
  }
  return melhor;
}

export function SituacaoVerbaChip({
  situacao,
  className,
  duasLinhas = false,
}: {
  situacao: SituacaoVerba;
  className?: string;
  /** Coluna estreita (Status da aba de PPs, decisão 189): o rótulo longo
   *  sai em duas linhas fixas e equilibradas, e a caixa abraça a linha
   *  maior — antes ele quebrava onde a coluna mandasse, e a caixa ocupava a
   *  célula inteira. */
  duasLinhas?: boolean;
}) {
  const linhas = duasLinhas ? emDuasLinhas(situacaoVerbaLabel(situacao)) : null;
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        CORES[situacao],
        className,
        linhas && "flex-col items-start gap-0 py-1 leading-[1.25]",
      )}
    >
      {linhas ? (
        <>
          <span className="whitespace-nowrap">{linhas[0]}</span>
          <span className="whitespace-nowrap">{linhas[1]}</span>
        </>
      ) : (
        situacaoVerbaLabel(situacao)
      )}
    </span>
  );
}
