import { createClient } from "@/lib/supabase/server";
import { tipoGeraDesembolso } from "@/lib/calculos/versao-totais";
import type { TipoCusto } from "@/lib/types";

/**
 * Um job na fila de abertura, com tudo que a conferência do financeiro
 * precisa mostrar antes de abrir. Os campos de planilha vêm agregados de
 * `jobs_itens_orcado` — a query da lista NÃO faz embed dos itens, que em
 * job grande passa de 40 linhas por job só para exibir um total.
 */
export interface JobNaFila {
  id: string;
  codigo: string;
  nome: string;
  valor_total: number | null;
  /** O que a California emite nota — difere do valor total pelos custos
   *  que o cliente paga direto ao fornecedor (A, D, F). */
  faturamento_previsto: number | null;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
  data_prevista_faturamento: string | null;
  observacoes: string | null;
  created_at: string;
  produto: string | null;
  cidade: string | null;
  projeto_id: string;
  projeto_codigo: string | null;
  projeto_nome: string | null;
  cliente_nome: string | null;
  regional_nome: string | null;
  responsavel_nome: string | null;
  produtor_nome: string | null;
  orcamento_codigo: string | null;
  /** Agregados da planilha interna do job. */
  planilha_grupos: number;
  planilha_itens: number;
  planilha_orcado: number;
  /** Planejado de TODOS os tipos — controle interno da planilha. */
  planilha_planejado: number;
  /** Planejado só dos tipos de calha PP (AR, B, C, F, FI) — o que a
   *  California de fato desembolsa. Vira o custo previsto na abertura
   *  (docs/decisions/004). */
  planilha_desembolso: number;
}

export interface TotaisPlanilhaJob {
  grupos: number;
  itens: number;
  orcado: number;
  planejado: number;
  desembolso: number;
}

const SELECT_JOB_FILA =
  "id, codigo, nome, valor_total, faturamento_previsto, data_inicio_prevista, data_fim_prevista, " +
  "data_prevista_faturamento, observacoes, created_at, produto, cidade, projeto_id, " +
  "projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia)), " +
  "regional:regionais(nome), " +
  "responsavel:profiles!responsavel_id(nome), " +
  "produtor:profiles!produtor_id(nome), " +
  "orcamento:orcamentos(codigo)";

/**
 * Soma o orçado e o planejado da planilha interna de vários jobs numa
 * query só. Chave do mapa é o job_id.
 */
export async function totaisDasPlanilhas(
  jobIds: string[],
): Promise<Map<string, TotaisPlanilhaJob>> {
  const mapa = new Map<string, TotaisPlanilhaJob>();
  if (jobIds.length === 0) return mapa;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("jobs_itens_orcado")
    .select("job_id, grupo_id, tipo_custo, total_orcado, total_planejado")
    .in("job_id", jobIds);

  if (error) {
    console.error("[abertura-job.totais-planilha]", error.message);
    return mapa;
  }

  const gruposPorJob = new Map<string, Set<string>>();

  for (const linha of (data ?? []) as {
    job_id: string;
    grupo_id: string | null;
    tipo_custo: TipoCusto;
    total_orcado: number | string | null;
    total_planejado: number | string | null;
  }[]) {
    const atual = mapa.get(linha.job_id) ?? {
      grupos: 0,
      itens: 0,
      orcado: 0,
      planejado: 0,
      desembolso: 0,
    };
    atual.itens += 1;
    atual.orcado += Number(linha.total_orcado ?? 0);
    atual.planejado += Number(linha.total_planejado ?? 0);
    if (tipoGeraDesembolso(linha.tipo_custo)) {
      atual.desembolso += Number(linha.total_planejado ?? 0);
    }
    mapa.set(linha.job_id, atual);

    if (linha.grupo_id) {
      const vistos = gruposPorJob.get(linha.job_id) ?? new Set<string>();
      vistos.add(linha.grupo_id);
      gruposPorJob.set(linha.job_id, vistos);
    }
  }

  for (const [jobId, vistos] of gruposPorJob) {
    const atual = mapa.get(jobId);
    if (atual) atual.grupos = vistos.size;
  }

  return mapa;
}

function montarJobNaFila(j: any, totais?: TotaisPlanilhaJob): JobNaFila {
  return {
    id: j.id,
    codigo: j.codigo,
    nome: j.nome,
    valor_total: j.valor_total !== null ? Number(j.valor_total) : null,
    faturamento_previsto:
      j.faturamento_previsto !== null && j.faturamento_previsto !== undefined
        ? Number(j.faturamento_previsto)
        : null,
    data_inicio_prevista: j.data_inicio_prevista,
    data_fim_prevista: j.data_fim_prevista,
    data_prevista_faturamento: j.data_prevista_faturamento,
    observacoes: j.observacoes,
    created_at: j.created_at,
    produto: j.produto,
    cidade: j.cidade,
    projeto_id: j.projeto_id,
    projeto_codigo: j.projeto?.codigo ?? null,
    projeto_nome: j.projeto?.nome ?? null,
    cliente_nome: j.projeto?.cliente?.nome_fantasia ?? null,
    regional_nome: j.regional?.nome ?? null,
    responsavel_nome: j.responsavel?.nome ?? null,
    produtor_nome: j.produtor?.nome ?? null,
    orcamento_codigo: j.orcamento?.codigo ?? null,
    planilha_grupos: totais?.grupos ?? 0,
    planilha_itens: totais?.itens ?? 0,
    planilha_orcado: totais?.orcado ?? 0,
    planilha_planejado: totais?.planejado ?? 0,
    planilha_desembolso: totais?.desembolso ?? 0,
  };
}

/**
 * Um job específico para a tela de abertura. Devolve também o status
 * cru, porque a página precisa desviar quem chegou num job que já foi
 * aberto ou reprovado por outra pessoa, e o nome de quem enviou o job
 * para abertura — o `created_by` do job, que é quem clicou em "Enviar
 * job para abertura" na tela da versão.
 *
 * O nome sai em query própria, e não em embed: `jobs.created_by` aponta
 * para `auth.users`, não para `profiles`, então o PostgREST não faz o
 * join sozinho. `profiles.id` É o id do usuário de auth.
 */
export async function carregarJobParaAbertura(
  tenantId: string,
  jobId: string,
): Promise<{
  job: JobNaFila;
  status: string;
  enviadoPorNome: string | null;
} | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("jobs")
    .select(`${SELECT_JOB_FILA}, status, created_by`)
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.error("[abertura-job.carregar]", error.message);
    return null;
  }
  if (!data) return null;

  const criadoPor = (data as any).created_by as string | null;

  const [totais, autorRes] = await Promise.all([
    totaisDasPlanilhas([jobId]),
    criadoPor
      ? supabase
          .from("profiles")
          .select("nome")
          .eq("id", criadoPor)
          .maybeSingle<{ nome: string | null }>()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (autorRes.error) {
    console.error("[abertura-job.enviado-por]", autorRes.error.message);
  }

  return {
    job: montarJobNaFila(data, totais.get(jobId)),
    status: (data as any).status,
    enviadoPorNome: autorRes.data?.nome ?? null,
  };
}

/** A fila inteira: jobs aguardando abertura, mais antigos primeiro. */
export async function listarFilaDeAbertura(
  tenantId: string,
): Promise<JobNaFila[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("jobs")
    .select(SELECT_JOB_FILA)
    .eq("tenant_id", tenantId)
    .eq("status", "aguardando_abertura")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[abertura-job.fila]", error.message);
    return [];
  }

  const linhas = (data ?? []) as any[];
  const totais = await totaisDasPlanilhas(linhas.map((j) => j.id));

  return linhas.map((j) => montarJobNaFila(j, totais.get(j.id)));
}
