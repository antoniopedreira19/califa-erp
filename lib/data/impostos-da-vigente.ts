import { createClient } from "@/lib/supabase/server";
import { escolherVersaoVigente } from "@/lib/calculos/versao-vigente";
import {
  ALIQUOTA_IMPOSTO_PADRAO,
  PERCENTUAL_INT_TAXES_PADRAO,
} from "@/lib/impostos";

/**
 * Impostos BR e int. taxes da versão VIGENTE de um orçamento — aprovada,
 * senão a mais recente não cancelada. Sem versão, os padrões.
 *
 * É o que uma versão nova de orçamento internacional recebe quando quem a
 * cria não tem `orcamentos.editar_impostos` (decisão do Tiago,
 * 14/09/2026): os dois percentuais mudam o valor cobrado do cliente e
 * seguem a mesma trava do fee. Herdar da vigente, e não dos padrões,
 * preserva um valor que um administrador já tenha ajustado.
 */
export async function impostosDaVersaoVigente(
  orcamentoId: string,
  tenantId: string,
): Promise<{ percentual_imposto: number; percentual_int_taxes: number }> {
  const supabase = createClient();
  const [{ data: orc }, { data: versoes }] = await Promise.all([
    supabase
      .from("orcamentos")
      .select("versao_aprovada_id")
      .eq("id", orcamentoId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ versao_aprovada_id: string | null }>(),
    supabase
      .from("versoes_orcamento")
      .select("id, numero_versao, status, created_at, percentual_imposto, percentual_int_taxes")
      .eq("orcamento_id", orcamentoId)
      .eq("tenant_id", tenantId)
      .neq("status", "cancelada")
      .returns<
        {
          id: string;
          numero_versao: number;
          status: string;
          created_at: string;
          percentual_imposto: number | string;
          percentual_int_taxes: number | string;
        }[]
      >(),
  ]);

  const vigente = escolherVersaoVigente(versoes ?? [], orc?.versao_aprovada_id);
  if (!vigente) {
    return {
      percentual_imposto: ALIQUOTA_IMPOSTO_PADRAO,
      percentual_int_taxes: PERCENTUAL_INT_TAXES_PADRAO,
    };
  }
  return {
    percentual_imposto: Number(vigente.percentual_imposto),
    percentual_int_taxes: Number(vigente.percentual_int_taxes),
  };
}
