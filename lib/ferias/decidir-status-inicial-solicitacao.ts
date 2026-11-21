import type { FeriasLancamentoStatus } from "@/lib/types";

/** Decide o status inicial de uma nova solicitação de férias com base em
 *  o colaborador ter ou não líder direto cadastrado.
 *
 *  - Com líder: entra em `aguardando_gestor`, aguardando a etapa 1 (líder).
 *  - Sem líder (null, vazio ou só espaços): pula direto para
 *    `pendente_aprovacao`, fluxo atual em que o RH é quem aprova.
 *
 *  Pura; sem I/O. Vai ser chamada pelo `solicitarFerias` no PR 2.
 */
export function decidirStatusInicialSolicitacao(params: {
  liderId: string | null;
}): FeriasLancamentoStatus {
  const lider = params.liderId?.trim() ?? "";
  if (lider.length === 0) return "pendente_aprovacao";
  return "aguardando_gestor";
}
