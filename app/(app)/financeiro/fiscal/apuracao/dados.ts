import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ESQUELETO (entrega 2 do fiscal): o agente da Apuração substitui este
 * arquivo inteiro, mantendo os três nomes exportados (`DadosDaApuracao`,
 * `carregarApuracao`, `contarGuiasAAprovar`), que a página usa.
 */
export interface DadosDaApuracao {
  tenantId: string;
}

export async function carregarApuracao(supabase: SupabaseClient, tenantId: string): Promise<DadosDaApuracao> {
  void supabase;
  return { tenantId };
}

export function contarGuiasAAprovar(dados: DadosDaApuracao): number {
  void dados;
  return 0;
}
