import type { SupabaseClient } from "@supabase/supabase-js";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";

/**
 * Gera código do projeto da produção no formato "P-[SEQ_4]/[ANO_2]".
 * Ex.: "P-0001/26". O projeto do financeiro leva "F" (`F-0001/26`).
 *
 * Decisão 210 (Tiago, 23/10/2026): o código do projeto não leva mais a
 * sigla do cliente. Serve só ao controle do sistema — quem lê a sigla é o
 * código do JOB (`AMB-1006/26`, decisão 114), que não muda. Até então o
 * projeto era "AMB-P004/26" e o do financeiro "AMB-F004/26"; os atuais
 * foram convertidos pela ordem de criação. `PRJ-`/`FIN-` foram descartados
 * porque existe cliente com a sigla FIN.
 *
 * Regras:
 *   - SEQ: por letra e ano, o maior número já usado + 1, com 4 dígitos.
 *     Número não volta a ser usado: o registro de códigos usados
 *     (`codigos_de_projeto_usados` na produção,
 *     `codigos_de_projeto_financeiro_usados` no financeiro) guarda o de
 *     projeto apagado.
 *   - ANO: o da CRIAÇÃO do projeto, no fuso de São Paulo. Até a 210 era o
 *     da data de início, que se edita depois.
 *
 * Sujeito a race condition entre dois cadastros simultâneos — o índice
 * único (tenant_id, codigo) captura a colisão.
 */
export async function gerarCodigoProjeto(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string> {
  return gerarCodigoDaLetra(supabase, "projetos", tenantId, LETRA_DO_PROJETO);
}

/** A letra do código: P na produção, F no financeiro. */
export const LETRA_DO_PROJETO = "P";
export const LETRA_DO_PROJETO_FINANCEIRO = "F";

const REGISTRO_DE_USADOS = {
  projetos: "codigos_de_projeto_usados",
  projetos_financeiro: "codigos_de_projeto_financeiro_usados",
} as const;

/** Lê os códigos já usados com a letra no ano — os de hoje e os do
 *  registro, que inclui os de projeto apagado — e devolve o próximo. */
export async function gerarCodigoDaLetra(
  supabase: SupabaseClient,
  tabela: "projetos" | "projetos_financeiro",
  tenantId: string,
  letra: string,
): Promise<string> {
  const ano = anoDoCodigoDeProjeto();
  // O LIKE só estreita a leitura; quem decide é a expressão em
  // `proximoCodigoDeProjeto`.
  const prefixo = `${letra}-%/${ano}`;
  const [atuaisRes, usadosRes] = await Promise.all([
    supabase
      .from(tabela)
      .select("codigo")
      .eq("tenant_id", tenantId)
      .like("codigo", prefixo),
    supabase
      .from(REGISTRO_DE_USADOS[tabela])
      .select("codigo")
      .eq("tenant_id", tenantId)
      .like("codigo", prefixo),
  ]);

  const erro = atuaisRes.error ?? usadosRes.error;
  if (erro) {
    throw new Error(`Falha ao ler os projetos existentes: ${erro.message}`);
  }
  return proximoCodigoDeProjeto({
    letra,
    ano,
    codigosUsados: [
      ...((atuaisRes.data ?? []) as { codigo: string }[]),
      ...((usadosRes.data ?? []) as { codigo: string }[]),
    ].map((p) => p.codigo),
  });
}

/** Os dois dígitos do ano do código de um projeto criado hoje. */
export function anoDoCodigoDeProjeto(hojeIso: string = hojeEmSaoPauloIso()): string {
  // Do texto, e não de `new Date(...)`: "2026-01-01" lido como data vira
  // 31/12/2025 em fuso atrás de UTC.
  return hojeIso.slice(2, 4);
}

/** "[LETRA]-[SEQ_4]/[ANO]", um acima do maior número já usado com a letra
 *  no ano. Código de outra letra, de outro ano ou no formato de antes da
 *  210 ("AMB-P004/26") não conta. */
export function proximoCodigoDeProjeto({
  letra,
  ano,
  codigosUsados,
}: {
  letra: string;
  ano: string;
  codigosUsados: readonly string[];
}): string {
  const padrao = new RegExp(`^${letra}-(\\d{4,})/${ano}$`);
  let maior = 0;
  for (const codigo of codigosUsados) {
    const m = padrao.exec(codigo);
    if (m) maior = Math.max(maior, Number(m[1]));
  }
  return `${letra}-${String(maior + 1).padStart(4, "0")}/${ano}`;
}
