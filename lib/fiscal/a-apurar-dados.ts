/**
 * A leitura do "<PJ> · a apurar no recebimento" (módulo fiscal, 03/10/2026):
 * os títulos a receber das notas da PJ do lucro presumido pelo caixa que
 * ainda podem estar em aberto, com o que as baixas já quitaram. A conta mora
 * em `./a-apurar.ts`.
 *
 * Depende dos fatos (`carregarFatosFiscais`): é deles que sai quais notas
 * consultar. Sem nota da PJ do caixa por quitar, nenhuma consulta é feita.
 * Com elas, duas, curtas: os títulos das notas e, dos que estão em aberto, o
 * baixado já somado (`vw_baixado_por_documento`, líquido + retidos — o mesmo
 * "o que falta" da lista de títulos e do fluxo de caixa), sem trazer as
 * baixas uma a uma.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CadastroFiscal } from "./cadastro";
import type { FatosFiscais } from "./apuracao";
import { blocosAApurar, montarTitulosAApurar, notasAConsultar, type BlocoAApurar, type TituloAApurar } from "./a-apurar";

export async function carregarTitulosAApurar(
  supabase: SupabaseClient,
  tenantId: string,
  cadastro: CadastroFiscal,
  fatos: FatosFiscais,
  hoje: string,
): Promise<TituloAApurar[]> {
  const notas = notasAConsultar(cadastro, fatos, hoje);
  if (notas.length === 0) return [];

  const titulosRes = await supabase
    .from("titulos_receber")
    .select("id, faturamento_id, numero_parcela, valor, data_vencimento, data_previsao_recebimento, status")
    .eq("tenant_id", tenantId)
    .in("faturamento_id", notas)
    .neq("status", "cancelado");
  if (titulosRes.error) throw new Error(`[fiscal.a-apurar.titulos] ${titulosRes.error.message}`);

  const abertos = ((titulosRes.data ?? []) as Array<{ id: string; status: string }>)
    .filter((t) => t.status === "em_aberto")
    .map((t) => t.id);
  if (abertos.length === 0) return [];

  const baixadoRes = await supabase
    .from("vw_baixado_por_documento")
    .select("documento_id, baixado")
    .eq("tenant_id", tenantId)
    .eq("documento_tipo", "titulo_receber")
    .in("documento_id", abertos);
  if (baixadoRes.error) throw new Error(`[fiscal.a-apurar.baixado] ${baixadoRes.error.message}`);

  return montarTitulosAApurar(titulosRes.data, baixadoRes.data);
}

/**
 * Os blocos da aba Apuração. Falha de leitura não derruba a aba: o bloco
 * some e a aba diz por quê.
 */
export async function carregarBlocosAApurar(
  supabase: SupabaseClient,
  tenantId: string,
  cadastro: CadastroFiscal,
  fatos: FatosFiscais,
  hoje: string,
): Promise<{ blocos: BlocoAApurar[]; erro: string | null }> {
  try {
    const titulos = await carregarTitulosAApurar(supabase, tenantId, cadastro, fatos, hoje);
    return { blocos: blocosAApurar(cadastro, fatos, titulos, hoje), erro: null };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    console.error("[fiscal.a-apurar]", mensagem);
    return { blocos: [], erro: mensagem };
  }
}
