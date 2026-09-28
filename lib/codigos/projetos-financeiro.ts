import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LETRA_DO_PROJETO_FINANCEIRO,
  lerBaseDoSequencial,
  proximoCodigoDeProjeto,
} from "./projetos";

/**
 * Gera código do projeto do financeiro: "[CODIGO_CURTO_CLIENTE]-F[SEQ_3]/[ANO_2]".
 * Ex.: "AMB-F003/26". O "F" ocupa o lugar do primeiro zero, como o "P" no
 * projeto da produção (decisão 114, 28/09/2026). Até então os dois usavam
 * o mesmo formato, e 8 códigos existiam nos dois lados apontando para
 * projetos diferentes; na abertura de job os dois aparecem na mesma tela.
 * O código de antes fica em `projetos_financeiro.codigo_anterior`.
 *
 * Sequencial PRÓPRIO, lido só dentro de `projetos_financeiro`. Os dois
 * espaços de código são independentes de propósito: as duas arrumações
 * divergem a partir do backfill, e amarrar o sequencial do financeiro ao
 * da produção faria o número pular sem motivo visível para quem usa.
 *
 * O número pode coincidir com o de um projeto da produção (AMB-P004/26 e
 * AMB-F004/26 são projetos diferentes); a letra é que separa os dois. É o
 * mesmo contrato de `jobs.nome_financeiro` vs `jobs.nome` — o financeiro
 * fala a língua dele.
 *
 * ⚠️ Até 14/09/2026 o sequencial era só a CONTAGEM de projetos do cliente
 * no ano + 1. O backfill copiou os códigos da produção, com os buracos
 * deles: o cliente Novo tinha NOV-0001/26 e NOV-0003/26, a contagem dava
 * 3, e o próximo projeto do Novo no financeiro caía no unique. Agora é a
 * mesma regra da produção — o maior entre a contagem do cliente + 1 e o
 * maior número da sigla + 1 (`proximoCodigoDeProjeto`, em `./projetos`).
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

  const { qtdDoCliente, codigosDaSigla } = await lerBaseDoSequencial(
    supabase,
    "projetos_financeiro",
    tenantId,
    clienteId,
    cliente.codigo_curto,
    ano,
  );
  return proximoCodigoDeProjeto({
    codigoCurto: cliente.codigo_curto,
    letra: LETRA_DO_PROJETO_FINANCEIRO,
    ano,
    qtdDoCliente,
    codigosDaSigla,
  });
}
