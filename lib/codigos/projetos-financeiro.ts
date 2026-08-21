import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Gera código do projeto do financeiro, no mesmo formato do projeto da
 * produção: "[CODIGO_CURTO_CLIENTE]-[SEQ_4]/[ANO_2]". Ex.: "AMB-0003/26".
 *
 * Sequencial PRÓPRIO, contado só dentro de `projetos_financeiro`. Os dois
 * espaços de código são independentes de propósito: as duas arrumações
 * divergem a partir do backfill, e amarrar o sequencial do financeiro ao
 * da produção faria o número pular sem motivo visível para quem usa.
 *
 * Consequência aceita: o mesmo código pode existir nas duas tabelas
 * apontando para arrumações diferentes. É o mesmo contrato de
 * `jobs.nome_financeiro` vs `jobs.nome` — o financeiro fala a língua
 * dele.
 *
 * Sujeito a race condition em concorrência alta, como o gerador de
 * `projetos`; o índice único (tenant_id, codigo) captura a colisão.
 */
export async function gerarCodigoProjetoFinanceiro(
  supabase: SupabaseClient,
  tenantId: string,
  clienteId: string,
  dataBase: string, // ISO "YYYY-MM-DD"
): Promise<string> {
  const { data: cliente, error: errCli } = await supabase
    .from("clientes")
    .select("codigo_curto")
    .eq("id", clienteId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ codigo_curto: string }>();

  if (errCli || !cliente?.codigo_curto) {
    throw new Error(
      "Cliente sem código curto — preencha no cadastro do cliente.",
    );
  }

  const ano = dataBase.slice(2, 4); // "2026-08-20" → "26"
  const sufixo = `/${ano}`;

  const { count, error: errCount } = await supabase
    .from("projetos_financeiro")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("cliente_id", clienteId)
    .like("codigo", `%${sufixo}`);

  if (errCount) {
    throw new Error(`Falha ao contar projetos: ${errCount.message}`);
  }

  const seq = ((count ?? 0) + 1).toString().padStart(4, "0");
  return `${cliente.codigo_curto}-${seq}/${ano}`;
}
