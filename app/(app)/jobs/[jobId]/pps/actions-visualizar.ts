"use server";

import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { COLUNAS_DE_PAGAMENTO } from "@/lib/data/foto-pagamento-da-pp";
import {
  SELECT_PP_DO_FINANCEIRO,
  mapearPPsDoFinanceiro,
} from "@/app/(app)/financeiro/contas-a-pagar/dados-dos-titulos";
import type { PPRow } from "@/app/(app)/financeiro/contas-a-pagar/pedidos-compra-list";
import type { EstabelecimentoDaNota } from "@/app/(app)/financeiro/contas-a-pagar/pp-dossie";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A PP enviada, no formato da tela do financeiro (08/10/2026).
 *
 * O "Ver PP" do job mostra os dados das NFs anexadas, e o "Visualizar"
 * abre a MESMA tela lado a lado do Contas a Pagar, em leitura. As duas
 * coisas partem daqui: a consulta e o mapeamento são os do financeiro
 * (`SELECT_PP_DO_FINANCEIRO` e `mapearPPsDoFinanceiro`), para a tela não
 * ter uma segunda versão de cada campo.
 *
 * Roda com a sessão de quem abre, e a RLS decide o que cada papel lê: o
 * freelancer não lê o cadastro de notas (`notas_fiscais_fornecedor`), e as
 * notas dele saem do que a produção informou no anexo — a cópia que o
 * banco mantém junto da nota.
 */
export async function carregarPPParaVisualizar(
  ppId: string,
): Promise<
  | { ok: true; pp: PPRow; estabelecimentos: EstabelecimentoDaNota[] }
  | { ok: false; message: string }
> {
  const session = await requireSession();
  if (!UUID.test(ppId)) return { ok: false, message: "PP não encontrada." };
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const [ppRes, estabelecimentosRes] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select(SELECT_PP_DO_FINANCEIRO)
      .eq("id", ppId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    // Todos os CNPJs, inclusive os inativos: a nota antiga mostra o CNPJ
    // dela mesmo depois que ele saiu da lista do envio.
    supabase
      .from("fiscal_estabelecimentos")
      .select("id, nome, cnpj, ativo")
      .eq("tenant_id", tenantId)
      .order("ordem")
      .order("nome"),
  ]);

  if (ppRes.error) {
    console.error("[job.pp.visualizar]", ppRes.error.message);
    return { ok: false, message: "Não foi possível carregar a PP. Tente de novo." };
  }
  if (!ppRes.data) return { ok: false, message: "PP não encontrada." };
  if (estabelecimentosRes.error) {
    console.error("[job.pp.visualizar.cnpjs]", estabelecimentosRes.error.message);
  }

  // O asterisco da decisão 067 compara a foto da PP com o cadastro de
  // pagamento do fornecedor de hoje. Só a PP com foto precisa dele.
  const linha = ppRes.data as unknown as {
    dados_pagamento_congelados_em: string | null;
    fornecedor: { id: string } | null;
  };
  let fornecedores: unknown[] = [];
  if (linha.dados_pagamento_congelados_em && linha.fornecedor?.id) {
    const { data } = await supabase
      .from("fornecedores")
      .select(`id, ${COLUNAS_DE_PAGAMENTO}`)
      .eq("id", linha.fornecedor.id)
      .eq("tenant_id", tenantId);
    fornecedores = data ?? [];
  }

  const [pp] = mapearPPsDoFinanceiro([ppRes.data], fornecedores);
  return {
    ok: true,
    pp,
    estabelecimentos: (estabelecimentosRes.data ?? []) as EstabelecimentoDaNota[],
  };
}
