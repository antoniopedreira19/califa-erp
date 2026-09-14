import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Gera código do projeto no formato "[CODIGO_CURTO_CLIENTE]-[SEQ_4]/[ANO_2]".
 * Ex.: "AMB-0003/26". O sequencial reinicia a cada ano.
 *
 * ⚠️ Até 14/09/2026 o sequencial era só a CONTAGEM de projetos do cliente no
 * ano + 1, e isso colidia com códigos que já existiam, por dois caminhos:
 *
 *   1. Projeto com número pulado (buraco): Pevetech tinha 5 projetos em
 *      2026 — um deles "0-0001/26" — e o maior era PEVETE-0006/26. A
 *      contagem dava 6, e o próximo projeto da Pevetech caía no unique.
 *   2. Projeto que trocou de cliente na edição (`atualizarProjeto` grava
 *      `cliente_id`, e o código fica): HITLAB guarda "NOV-0001/26" e
 *      SEBRAE guarda "NOV-0004/26". Contando por cliente, o cliente Novo
 *      não enxerga esses dois, e a sequência dele esbarra neles.
 *
 * Agora o sequencial é o MAIOR entre (Tiago, 14/09/2026):
 *   - a contagem de projetos do cliente no ano + 1 — o número continua
 *     dizendo quantos projetos o cliente tem, como sempre leu; e
 *   - o maior número já usado naquela sigla e ano, em qualquer cliente,
 *     + 1 — o espaço que o índice único (tenant_id, codigo) protege.
 * Número não volta a ser usado, e o código nunca colide.
 *
 * Sujeito a race condition entre dois cadastros simultâneos — o índice
 * único captura a colisão.
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

  // Do texto, e não de `new Date(...)`: "2026-01-01" lido como data vira
  // 31/12/2025 em fuso atrás de UTC, e o projeto de 1º de janeiro ganhava
  // o ano anterior.
  const ano = dataInicio.slice(2, 4); // "2026-07-28" → "26"

  const { qtdDoCliente, codigosDaSigla } = await lerBaseDoSequencial(
    supabase,
    "projetos",
    tenantId,
    clienteId,
    cliente.codigo_curto,
    ano,
  );
  return proximoCodigoDeProjeto({
    codigoCurto: cliente.codigo_curto,
    ano,
    qtdDoCliente,
    codigosDaSigla,
  });
}

/** As duas bases do sequencial, lidas em paralelo: quantos projetos o
 *  cliente tem no ano, e os códigos já usados com a sigla no ano (em
 *  qualquer cliente). */
export async function lerBaseDoSequencial(
  supabase: SupabaseClient,
  tabela: "projetos" | "projetos_financeiro",
  tenantId: string,
  clienteId: string,
  codigoCurto: string,
  ano: string,
): Promise<{ qtdDoCliente: number; codigosDaSigla: string[] }> {
  const [contagemRes, codigosRes] = await Promise.all([
    supabase
      .from(tabela)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("cliente_id", clienteId)
      .like("codigo", `%/${ano}`),
    // O LIKE só estreita a leitura; quem decide é a expressão em
    // `proximoCodigoDeProjeto` (um "_" no código curto seria curinga).
    supabase
      .from(tabela)
      .select("codigo")
      .eq("tenant_id", tenantId)
      .like("codigo", `${codigoCurto}-%/${ano}`),
  ]);

  const erro = contagemRes.error ?? codigosRes.error;
  if (erro) {
    throw new Error(`Falha ao ler os projetos existentes: ${erro.message}`);
  }
  return {
    qtdDoCliente: contagemRes.count ?? 0,
    codigosDaSigla: ((codigosRes.data ?? []) as { codigo: string }[]).map(
      (p) => p.codigo,
    ),
  };
}

/** "[SIGLA]-[sequencial]/[ANO]", com o sequencial no maior entre a
 *  contagem do cliente + 1 e o maior número da sigla + 1. Código de outra
 *  sigla ou de outro ano não conta para o maior. */
export function proximoCodigoDeProjeto({
  codigoCurto,
  ano,
  qtdDoCliente,
  codigosDaSigla,
}: {
  codigoCurto: string;
  ano: string;
  qtdDoCliente: number;
  codigosDaSigla: string[];
}): string {
  const escapado = codigoCurto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const padrao = new RegExp(`^${escapado}-(\\d+)/${ano}$`);
  let maior = 0;
  for (const codigo of codigosDaSigla) {
    const m = padrao.exec(codigo);
    if (m) maior = Math.max(maior, Number(m[1]));
  }
  const seq = Math.max(qtdDoCliente + 1, maior + 1);
  return `${codigoCurto}-${seq.toString().padStart(4, "0")}/${ano}`;
}
