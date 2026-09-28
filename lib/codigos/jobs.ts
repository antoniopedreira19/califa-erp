import type { SupabaseClient } from "@supabase/supabase-js";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";

/**
 * Código do job: "[SIGLA]-[SEQ_4]/[ANO_2]" — o formato que nomeava os
 * projetos até então (decisão 114, Tiago, 28/09/2026). Ex.: "AMB-1006/26".
 *
 *   - SIGLA: o código curto ATUAL do cliente do projeto. Não a sigla que
 *     está no código do projeto: ela fica velha quando o projeto troca de
 *     cliente (o HIT-0001/26 é da Universal, UER).
 *   - ANO: o ano em que o job é criado, no fuso de São Paulo. Não a data
 *     de início, que se edita depois — e o código não muda.
 *   - SEQ: o maior número já usado na sigla e no ano, + 1. Número não
 *     volta a ser usado: job cancelado ou apagado queima o dele.
 *
 * Em 2026 o sequencial começa em 1001 — o "1 no lugar do primeiro 0". O
 * outro sistema da agência abre jobs no mesmo formato e ainda não chegou no
 * milhar; começar em 1001 garante que nenhum código se repete entre os
 * dois. De 2027 em diante o sequencial começa em 0001.
 *
 * ⚠️ Até 28/09/2026 o código era `JOB-NNNN`, um sequencial único do
 * tenant. Os jobs daquela época guardam o código antigo em
 * `jobs.codigo_anterior`.
 *
 * Sujeito a race condition entre dois envios simultâneos — o índice único
 * (tenant_id, codigo) captura a colisão, e a tela pede para tentar de novo.
 */

/** O primeiro número de cada ano, menos um. Só 2026 tem piso. */
const PISO_DO_SEQUENCIAL: Readonly<Record<string, number>> = { "26": 1000 };

/** Os dois dígitos do ano do código de um job criado hoje. */
export function anoDoCodigoDeJob(hojeIso: string = hojeEmSaoPauloIso()): string {
  return hojeIso.slice(2, 4); // "2026-09-28" → "26"
}

/** O código seguinte, dados os códigos já usados (de qualquer sigla e ano:
 *  só os da mesma sigla e ano contam). */
export function proximoCodigoDeJob({
  sigla,
  ano,
  codigos,
}: {
  sigla: string;
  ano: string;
  codigos: readonly string[];
}): string {
  const escapada = sigla.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const padrao = new RegExp(`^${escapada}-(\\d{4})/${ano}$`);
  let maior = PISO_DO_SEQUENCIAL[ano] ?? 0;
  for (const codigo of codigos) {
    const m = padrao.exec(codigo);
    if (m) maior = Math.max(maior, Number(m[1]));
  }
  return `${sigla}-${String(maior + 1).padStart(4, "0")}/${ano}`;
}

/**
 * Ordem cronológica entre códigos de job: ano, depois número. Dentro de um
 * projeto (uma sigla) é a ordem de criação — inclusive na virada do ano,
 * quando o AMB-0001/27 vem depois do AMB-1005/26, e o texto puro diria o
 * contrário. Código antigo `JOB-NNNN` conta como anterior a todos. Para
 * listas com vários clientes, prefira a data de criação.
 */
export function compararCodigosDeJob(a: string, b: string): number {
  const chave = (codigo: string): [number, number] => {
    const novo = /^[^-]+-(\d{4})\/(\d{2})$/.exec(codigo);
    if (novo) return [Number(novo[2]), Number(novo[1])];
    const antigo = /^JOB-(\d+)$/.exec(codigo);
    return antigo ? [-1, Number(antigo[1])] : [-1, 0];
  };
  const [anoA, seqA] = chave(a);
  const [anoB, seqB] = chave(b);
  return anoA - anoB || seqA - seqB || a.localeCompare(b);
}

/**
 * Gera o código do próximo job de um projeto: a sigla vem do cliente do
 * projeto, o ano é o de hoje.
 */
export async function gerarCodigoJob(
  supabase: SupabaseClient,
  tenantId: string,
  projetoId: string,
): Promise<string> {
  const { data: projeto, error: errProj } = await supabase
    .from("projetos")
    .select("cliente:clientes(codigo_curto)")
    .eq("id", projetoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ cliente: { codigo_curto: string | null } | null }>();

  const sigla = projeto?.cliente?.codigo_curto;
  if (errProj || !sigla) {
    throw new Error(
      "O cliente do projeto está sem código curto — preencha no cadastro do cliente.",
    );
  }

  const ano = anoDoCodigoDeJob();
  // Só a coluna do código, e só a sigla e o ano: leitura leve. O LIKE só
  // estreita; quem decide é a expressão de `proximoCodigoDeJob`.
  const { data, error } = await supabase
    .from("jobs")
    .select("codigo")
    .eq("tenant_id", tenantId)
    .like("codigo", `${sigla}-%/${ano}`);

  if (error) {
    throw new Error(`Falha ao ler os códigos de job: ${error.message}`);
  }

  return proximoCodigoDeJob({
    sigla,
    ano,
    codigos: ((data ?? []) as { codigo: string }[]).map((j) => j.codigo),
  });
}
