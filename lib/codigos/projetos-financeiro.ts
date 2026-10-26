import type { SupabaseClient } from "@supabase/supabase-js";
import { LETRA_DO_PROJETO_FINANCEIRO, gerarCodigoDaLetra } from "./projetos";

/**
 * Gera código do projeto do financeiro: "F-[SEQ_4]/[ANO_2]". Ex.:
 * "F-0001/26". Mesma regra do projeto da produção ("P-0001/26"), em
 * sequência própria (decisão 210, 23/10/2026): sem a sigla do cliente,
 * por letra e ano da criação, e número que não volta a ser usado — o
 * projeto do financeiro sem job é apagado (decisão 119), e o código dele
 * fica em `codigos_de_projeto_financeiro_usados`.
 *
 * Os dois cadastros de projeto continuam separados, cada um com a sua
 * numeração: o financeiro agrupa os jobs do jeito dele, e amarrar o
 * sequencial ao da produção faria o número pular sem motivo visível. O
 * número pode coincidir (P-0004/26 e F-0004/26 são projetos diferentes);
 * a letra é que separa os dois.
 *
 * Sujeito a race condition em concorrência alta, como o gerador de
 * `projetos`; o índice único (tenant_id, codigo) captura a colisão.
 */
export async function gerarCodigoProjetoFinanceiro(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string> {
  return gerarCodigoDaLetra(
    supabase,
    "projetos_financeiro",
    tenantId,
    LETRA_DO_PROJETO_FINANCEIRO,
  );
}
