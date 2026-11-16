import { cn } from "@/lib/utils";
import { situacaoVerbaLabel, type SituacaoVerba } from "@/lib/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * O chip da situação da verba depois de paga (decisão 081) — o mesmo na lista
 * de PPs e em Títulos a Pagar, na aba de PPs do job, no painel do item e na
 * tela da PP. "A prestar" leva borda tracejada: é a única situação em que
 * alguém deve algo e ainda não fez nada.
 */
const CORES: Record<SituacaoVerba, string> = {
  aguardando_prestacao: "border-dashed border-amber-400 bg-amber-50 text-amber-800",
  prestacao_em_avaliacao: "border-yellow-200 bg-yellow-50 text-yellow-800",
  prestacao_reprovada: "border-california-red/30 bg-california-red/10 text-california-red",
  devolucao_pendente: "border-teal-200 bg-teal-50 text-teal-800",
  concluida: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

/**
 * Decisão 257: o chip mostra o nome curto, para a coluna de Status não
 * alargar a tabela; o nome inteiro (`situacaoVerbaLabel`) fica no filtro da
 * coluna e aparece ao passar o mouse, com o que ele quer dizer. "A devolver"
 * é o nome que a planilha de Títulos a Pagar já dá ao título da devolução.
 */
const CURTO: Record<SituacaoVerba, { rotulo: string; dica: string }> = {
  aguardando_prestacao: {
    rotulo: "A prestar",
    dica: "a produção ainda não enviou a prestação de contas da verba.",
  },
  prestacao_em_avaliacao: {
    rotulo: "Prestação",
    dica: "a produção enviou a prestação; falta o financeiro aprovar.",
  },
  prestacao_reprovada: {
    rotulo: "Reprovada",
    dica: "a prestação voltou para a produção corrigir e reenviar.",
  },
  devolucao_pendente: {
    rotulo: "A devolver",
    dica: "a prestação foi aprovada e sobrou saldo da verba; falta a baixa da devolução.",
  },
  concluida: {
    rotulo: "Concluída",
    dica: "a prestação foi aprovada, e a sobra (se houve) já foi devolvida.",
  },
};

export function SituacaoVerbaChip({ situacao, className }: { situacao: SituacaoVerba; className?: string }) {
  const { rotulo, dica } = CURTO[situacao];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            CORES[situacao],
            className,
          )}
        >
          {rotulo}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px]">
        <strong className="font-semibold">{situacaoVerbaLabel(situacao)}:</strong> {dica}
      </TooltipContent>
    </Tooltip>
  );
}
