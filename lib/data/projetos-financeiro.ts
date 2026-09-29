import { createClient } from "@/lib/supabase/server";

/**
 * Projeto na visão do financeiro (`projetos_financeiro`).
 *
 * Não é o projeto da produção. `jobs.projeto_id` continua nascendo do
 * orçamento e mandando em Orçamentos e na página de Jobs; este aqui é a
 * arrumação que o financeiro faz dos jobs dele, e a produção nunca vê —
 * mesmo contrato de `jobs.nome_financeiro` vs `jobs.nome`.
 *
 * A tabela nasceu espelhando `projetos` (backfill da migration
 * 20260820000011) para o combo não abrir vazio; a partir dali as duas
 * arrumações divergem à vontade.
 */
export interface ProjetoFinanceiroOpcao {
  id: string;
  codigo: string;
  nome: string;
  cliente_id: string;
  cliente_nome: string | null;
}

/**
 * Projetos do financeiro ativos, para o combo da abertura.
 *
 * `clienteId` filtra por cliente: agrupar jobs de clientes diferentes sob
 * o mesmo projeto não é arrumação, é engano — e o combo do protótipo já
 * mostra o cliente em cada linha justamente para isso ficar visível.
 */
export async function listarProjetosFinanceiro(
  tenantId: string,
  clienteId?: string | null,
): Promise<ProjetoFinanceiroOpcao[]> {
  const supabase = createClient();

  let query = supabase
    .from("projetos_financeiro")
    .select("id, codigo, nome, cliente_id, cliente:clientes(nome_fantasia)")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("codigo", { ascending: true });

  if (clienteId) query = query.eq("cliente_id", clienteId);

  const { data, error } = await query;

  if (error) {
    console.error("[projetos-financeiro.listar]", error.message);
    return [];
  }

  return ((data ?? []) as any[]).map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nome: p.nome,
    cliente_id: p.cliente_id,
    cliente_nome: p.cliente?.nome_fantasia ?? null,
  }));
}
