"use server";

/**
 * O "Exportar remessa Santander" da aba Títulos da conciliação (decisão
 * 195): o mesmo diálogo de Títulos a Pagar, com os títulos montados pela
 * mesma função (`contas-a-pagar/titulos-da-remessa.ts`). Lido só no clique:
 * a aba Títulos não carrega o que a remessa pede (o destino de cada título,
 * os colaboradores, as retenções da aprovação) a cada visita.
 */

import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import type { ContaBancaria } from "@/lib/types";
import { COLUNAS_DE_PAGAMENTO } from "@/lib/data/foto-pagamento-da-pp";
import { carregarColaboradoresPagamento } from "@/lib/financeiro/colaboradores-pagamento";
import { SELECT_PP_DO_FINANCEIRO, mapearPPsDoFinanceiro } from "../contas-a-pagar/dados-dos-titulos";
import { montarDadosDaRemessa } from "../contas-a-pagar/titulos-da-remessa";
import type { ContaSantanderElegivel, TituloElegivelParaRemessa } from "../contas-a-pagar/remessa-cnab-dialog";

type Resultado =
  | { ok: true; contasSantander: ContaSantanderElegivel[]; titulos: TituloElegivelParaRemessa[]; canGerar: boolean }
  | { ok: false; message: string };

export async function carregarDadosDaRemessa(): Promise<Resultado> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: "Apenas admin ou financeiro pode gerar a remessa." };
  }
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const [contasRes, fornecedoresRes, colaboradores, ppsRes, retencoesRes, aPagarRes] = await Promise.all([
    supabase
      .from("contas_bancarias")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .neq("tipo", "cartao_credito")
      .returns<ContaBancaria[]>(),
    supabase
      .from("fornecedores")
      .select(`id, nome, razao_social, cpf_cnpj, ${COLUNAS_DE_PAGAMENTO}`)
      .eq("tenant_id", tenantId)
      .eq("status", "ativo"),
    carregarColaboradoresPagamento(supabase, tenantId),
    // Só a PP que pode ter título a pagar: a fora do cadastro e a verba
    // mudam o que o arquivo paga.
    supabase
      .from("pedidos_compra")
      .select(SELECT_PP_DO_FINANCEIRO)
      .eq("tenant_id", tenantId)
      .in("status", ["aprovada", "pago"])
      .not("enviada_financeiro_em", "is", null),
    supabase.from("pedidos_compra_retencoes").select("pedido_compra_id, imposto, aliquota").eq("tenant_id", tenantId),
    supabase
      .from("vw_a_pagar")
      .select("origem_tipo, origem_id, descricao, valor, fornecedor_id, colaborador_id")
      .eq("tenant_id", tenantId)
      .eq("natureza", "saida"),
  ]);
  for (const [nome, res] of [
    ["contas", contasRes],
    ["fornecedores", fornecedoresRes],
    ["pps", ppsRes],
    ["retencoes", retencoesRes],
    ["a_pagar", aPagarRes],
  ] as const) {
    if (res.error) {
      console.error(`[conciliacao.remessa.${nome}]`, res.error.message);
      return { ok: false, message: "Não foi possível ler os títulos da remessa. Tente de novo." };
    }
  }

  const { contasSantander, titulosCnab } = montarDadosDaRemessa({
    contas: contasRes.data ?? [],
    fornecedores: fornecedoresRes.data,
    colaboradores,
    pps: mapearPPsDoFinanceiro(ppsRes.data, fornecedoresRes.data),
    retencoesDaAprovacao: retencoesRes.data,
    aPagar: aPagarRes.data,
  });
  return {
    ok: true,
    contasSantander,
    titulos: titulosCnab,
    canGerar: pode(session.activeRole, "financeiro.contas_pagar"),
  };
}
