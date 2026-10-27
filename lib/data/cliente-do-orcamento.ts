import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteDoCampo } from "@/app/(app)/clientes/campo-cliente";
import type { ProdutoOption } from "@/app/(app)/orcamentos/projeto-form";

/**
 * As listas dos campos Cliente e Marca do formulário do orçamento
 * (decisão 215) e a sugestão que o orçamento novo traz: o cliente e a
 * marca do último orçamento do projeto. Uma onda só, em paralelo.
 */
export interface OpcoesDoClienteDoOrcamento {
  clientes: ClienteDoCampo[];
  produtos: ProdutoOption[];
  sugestao: { clienteId: string; marcaId: string; orcamentoNome: string } | null;
  /** Honorários do cadastro de cada cliente: a v1 do orçamento novo nasce
   *  com os do cliente escolhido. */
  honorariosPorCliente: Record<string, number>;
}

export async function carregarClienteDoOrcamento(
  supabase: SupabaseClient<any, any, any>,
  tenantId: string,
  projetoId: string,
): Promise<OpcoesDoClienteDoOrcamento> {
  const [clientesRes, produtosRes, ultimoRes] = await Promise.all([
    supabase
      .from("clientes")
      .select("id, nome_fantasia, codigo_curto, percentual_honorarios_padrao")
      .eq("tenant_id", tenantId)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    // Cadastro pequeno (por cliente): vem inteiro e o formulário filtra
    // pelo cliente escolhido, sem ida extra ao servidor a cada troca.
    supabase
      .from("cliente_produtos")
      .select("id, nome, codigo, cliente_id, padrao")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("codigo"),
    supabase
      .from("orcamentos")
      .select("nome, cliente_id, produto_id")
      .eq("tenant_id", tenantId)
      .eq("projeto_id", projetoId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  if (clientesRes.error) console.error("[orcamento.clientes]", clientesRes.error.message);
  if (produtosRes.error) console.error("[orcamento.marcas]", produtosRes.error.message);
  if (ultimoRes.error) console.error("[orcamento.sugestao]", ultimoRes.error.message);

  const ultimo = ((ultimoRes.data ?? []) as any[])[0];
  const clientes = (clientesRes.data ?? []) as Array<
    ClienteDoCampo & { percentual_honorarios_padrao: number | string | null }
  >;
  return {
    clientes: clientes.map((c) => ({
      id: c.id,
      nome_fantasia: c.nome_fantasia,
      codigo_curto: c.codigo_curto ?? null,
    })),
    honorariosPorCliente: Object.fromEntries(
      clientes
        .filter((c) => c.percentual_honorarios_padrao !== null)
        .map((c) => [c.id, Number(c.percentual_honorarios_padrao)]),
    ),
    produtos: (produtosRes.data ?? []) as ProdutoOption[],
    sugestao: ultimo?.cliente_id
      ? {
          clienteId: ultimo.cliente_id as string,
          marcaId: (ultimo.produto_id as string | null) ?? "",
          orcamentoNome: ultimo.nome as string,
        }
      : null,
  };
}
