import { createClient } from "@/lib/supabase/server";

/**
 * Contato de cobrança do job — quem o financeiro procura para receber.
 *
 * A produção informa no envio para abertura (`docs/decisions/012`), e a
 * tabela `jobs_contatos` guarda uma linha por contato, com `tipo`
 * `cobranca`. Job anterior a 17/08/2026 não tem nenhum: a exigência
 * nasceu com a Tela 1.6 e não houve backfill.
 *
 * Este carregador existe porque a leitura passou a acontecer em QUATRO
 * telas do financeiro (17/08/2026) — conferência da fila, job aberto,
 * Faturamento e Títulos a Receber. Uma query por tela, sempre a mesma
 * forma; a alternativa era o mesmo `select` copiado em quatro lugares,
 * que é exatamente como as cores das planilhas divergiram.
 */
export interface ContatoCobranca {
  nome: string;
  numero: string;
  email: string;
}

const VAZIO = new Map<string, ContatoCobranca[]>();

/**
 * Contatos de cobrança de vários jobs de uma vez, indexados por
 * `job_id`. Uma query só, coberta pelo índice `idx_jobs_contatos_job` —
 * nada de N+1 por linha de tabela (`docs/PERFORMANCE.md`).
 *
 * Job sem contato simplesmente não aparece no mapa; quem consome trata
 * a ausência, que é um estado legítimo e não um erro.
 */
export async function contatosDeCobrancaPorJob(
  jobIds: string[],
  tenantId: string,
): Promise<Map<string, ContatoCobranca[]>> {
  const ids = [...new Set(jobIds.filter(Boolean))];
  if (ids.length === 0) return VAZIO;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("jobs_contatos")
    .select("job_id, nome, numero, email")
    .in("job_id", ids)
    .eq("tenant_id", tenantId)
    .eq("tipo", "cobranca")
    .order("ordem", { ascending: true });

  if (error) {
    console.error("[contatos-cobranca]", error.message);
    return VAZIO;
  }

  const mapa = new Map<string, ContatoCobranca[]>();
  for (const linha of (data ?? []) as any[]) {
    const lista = mapa.get(linha.job_id as string) ?? [];
    lista.push({
      nome: (linha.nome as string | null) ?? "",
      numero: (linha.numero as string | null) ?? "",
      email: (linha.email as string | null) ?? "",
    });
    mapa.set(linha.job_id as string, lista);
  }
  return mapa;
}

/** Atalho para uma tela que olha um job só. */
export async function contatosDeCobrancaDoJob(
  jobId: string,
  tenantId: string,
): Promise<ContatoCobranca[]> {
  const mapa = await contatosDeCobrancaPorJob([jobId], tenantId);
  return mapa.get(jobId) ?? [];
}
