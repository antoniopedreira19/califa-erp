/**
 * As linhas do job que a revisão da abertura ainda não conferiu (decisão
 * 185, 16/10/2026).
 *
 * A errata em job aberto devolve o job ao mural do financeiro
 * (`jobs.abertura_em_revisao`). Até a 185 isso fechava o envio de TODA PP
 * do job (decisão 040); agora fecha só o da linha que alguma errata ainda
 * não revisada mudou. As outras linhas enviam normalmente.
 *
 * "Ainda não revisada" é a mesma janela do mural (`revisoesPendentes`, em
 * `financeiro/abertura-de-job/dados.ts`): a errata registrada depois do
 * último registro de abertura ou revisão (`jobs_aberturas`) ou, sem
 * registro, da data de abertura. Com duas erratas na mesma revisão, valem
 * as linhas das duas.
 *
 * "Mudou" é ter linha em `jobs_erratas_itens`: orçado, planejado ou tipo
 * alterados, linha nova, cancelada ou removida. A errata que só reorganiza
 * a planilha (decisão 162) não grava linha ali, então mover item de grupo
 * ou renomear grupo não trava nada — escolha do Tiago.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ErrataComLinhas {
  created_at: string;
  itens: ReadonlyArray<{ job_item_orcado_id: string | null }> | null;
}

/**
 * O início da janela: o mais recente entre a data de abertura e o último
 * registro de abertura ou revisão. Nulo: nenhuma das duas existe, e toda
 * errata conta.
 */
export function inicioDaRevisao(
  dataAbertura: string | null,
  ultimoRegistro: string | null,
): number | null {
  const marcos = [dataAbertura, ultimoRegistro]
    .filter((x): x is string => Boolean(x))
    .map((x) => new Date(x).getTime());
  return marcos.length > 0 ? Math.max(...marcos) : null;
}

/** As linhas (`jobs_itens_orcado.id`) das erratas registradas depois de `inicio`. */
export function linhasAlteradasDesde(
  erratas: ReadonlyArray<ErrataComLinhas>,
  inicio: number | null,
): Set<string> {
  const linhas = new Set<string>();
  for (const e of erratas) {
    if (inicio !== null && new Date(e.created_at).getTime() <= inicio) continue;
    for (const i of e.itens ?? []) {
      if (i.job_item_orcado_id) linhas.add(i.job_item_orcado_id);
    }
  }
  return linhas;
}

/** O último registro de abertura ou revisão do job. */
export function ultimoRegistroDaAbertura(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
) {
  return supabase
    .from("jobs_aberturas")
    .select("registrado_em")
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .order("registrado_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ registrado_em: string }>();
}

/**
 * Para a action do envio: lê as erratas e o último registro e devolve as
 * linhas travadas. Fora de revisão, nenhuma. `null` quando a leitura
 * falha: quem chama trava o envio, que é o passo que compromete dinheiro.
 */
export async function linhasAlteradasNaRevisao(
  supabase: SupabaseClient,
  tenantId: string,
  job: {
    id: string;
    abertura_em_revisao: boolean;
    data_abertura_financeiro: string | null;
  },
): Promise<Set<string> | null> {
  if (!job.abertura_em_revisao) return new Set();
  const [registroRes, erratasRes] = await Promise.all([
    ultimoRegistroDaAbertura(supabase, tenantId, job.id),
    supabase
      .from("jobs_erratas")
      .select("created_at, itens:jobs_erratas_itens(job_item_orcado_id)")
      .eq("job_id", job.id)
      .eq("tenant_id", tenantId)
      .returns<ErrataComLinhas[]>(),
  ]);
  if (registroRes.error || erratasRes.error) {
    console.error(
      "[revisao.linhas]",
      registroRes.error?.message ?? erratasRes.error?.message,
    );
    return null;
  }
  return linhasAlteradasDesde(
    erratasRes.data ?? [],
    inicioDaRevisao(
      job.data_abertura_financeiro,
      registroRes.data?.registrado_em ?? null,
    ),
  );
}
