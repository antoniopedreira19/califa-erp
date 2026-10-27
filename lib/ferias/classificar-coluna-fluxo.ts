import type { RhFeriasFluxoRow } from "@/lib/types";
import type { ColunaFluxoFerias } from "@/lib/types";

export function classificarColunaFluxo(row: RhFeriasFluxoRow): ColunaFluxoFerias {
  const { status_lancamento, folhas_total, folhas_pagas, todas_pagas, todas_enviadas } = row;

  switch (status_lancamento) {
    case "pendente_aprovacao":
      return "pendente";

    case "reprovado":
    case "cancelado":
    case "concluido":
      return "finalizada";

    case "aprovado": {
      if (folhas_total === 0) return "em_andamento";
      if (todas_pagas) return "finalizada";
      if (folhas_pagas > 0 && folhas_pagas < folhas_total) return "parcial";
      if (todas_enviadas) return "enviada";
      return "em_andamento";
    }

    default:
      return "em_andamento";
  }
}
