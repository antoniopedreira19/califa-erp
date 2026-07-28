import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Gera código do projeto no formato "[CODIGO_CURTO_CLIENTE]-[SEQ_4]/[ANO_2]".
 * Sequencial reinicia a cada ano por cliente. Ex.: "AMB-0003/26".
 *
 * Sujeito a race condition em cenários de concorrência alta — o índice
 * único (tenant_id, codigo) captura colisões. Para o MVP é aceitável.
 */
export async function gerarCodigoProjeto(
  supabase: SupabaseClient,
  tenantId: string,
  clienteId: string,
  dataInicio: string, // ISO "YYYY-MM-DD"
): Promise<string> {
  // 1) codigo_curto do cliente
  const { data: cliente, error: errCli } = await supabase
    .from("clientes")
    .select("codigo_curto")
    .eq("id", clienteId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ codigo_curto: string }>();

  if (errCli || !cliente?.codigo_curto) {
    throw new Error("Cliente sem codigo_curto — preencha no cadastro do cliente.");
  }

  const codigoCurto = cliente.codigo_curto;
  const ano = dataInicio.slice(2, 4); // "2026-07-28" → "26"

  // 2) Conta projetos existentes desse cliente cujo código termine em "/<ano>"
  //    Usa LIKE porque não temos coluna separada de ano.
  const sufixo = `/${ano}`;
  const { count, error: errCount } = await supabase
    .from("projetos")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("cliente_id", clienteId)
    .like("codigo", `%${sufixo}`);

  if (errCount) {
    throw new Error(`Falha ao contar projetos: ${errCount.message}`);
  }

  const seq = ((count ?? 0) + 1).toString().padStart(4, "0");
  return `${codigoCurto}-${seq}/${ano}`;
}
