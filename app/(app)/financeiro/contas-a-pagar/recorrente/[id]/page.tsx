import { redirect } from "next/navigation";

/**
 * Decisão 272: os detalhes da recorrência saíram da página e abrem no pop-up
 * da aba Recorrências. O endereço antigo (links do título, do histórico)
 * continua valendo e leva à lista com o pop-up aberto.
 */
export default function RecorrenteRedirect({ params }: { params: { id: string } }) {
  redirect(`/financeiro/contas-a-pagar?tab=recorrentes&rec=${encodeURIComponent(params.id)}`);
}
