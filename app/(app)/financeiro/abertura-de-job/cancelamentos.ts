/**
 * A faixa "Cancelamentos" da fila da Abertura de Job (decisão 169): os
 * pedidos da produção para cancelar job já aberto, com o que o financeiro
 * precisa para decidir — quem pediu e por quê, os dados do job, e o que o
 * cancelamento tira das contas.
 *
 * Duas ondas. A primeira traz os pedidos no ar (índice parcial
 * `idx_jobs_cancelamentos_pendentes`) com o job embutido; sem pedido, para
 * aí. A segunda, em paralelo, soma as previsões, resume a planilha e
 * confere se o projeto financeiro tem outro job vivo — todas por `in`, nunca
 * uma por pedido (docs/PERFORMANCE.md).
 */
import { createClient } from "@/lib/supabase/server";
import { SELECT_CANCELAMENTO, paraCancelamento } from "@/lib/data/cancelamentos";
import type { CancelamentoDoJob } from "@/lib/types";

export interface CancelamentoNaFila {
  pedido: CancelamentoDoJob;
  jobId: string;
  codigo: string;
  /** O nome que o financeiro vê (`nome_financeiro`, com o da produção). */
  nome: string;
  projetoCodigo: string | null;
  projetoNome: string | null;
  clienteNome: string | null;
  produto: string | null;
  responsavelNome: string | null;
  regionalNome: string | null;
  valorTotal: number;
  /** ISO. */
  abertoEm: string | null;
  abertoPorNome: string | null;
  projetoFinanceiroCodigo: string | null;
  /** Sem outro job vivo, a aprovação deixa o projeto financeiro inativo. */
  projetoFinanceiroFicaInativo: boolean;
  /** O que sai do fluxo de caixa: as previsões gravadas na abertura. */
  recebimentoPrevisto: number;
  custoPrevisto: number;
  impostosPrevistos: number;
  planilha: { grupos: number; itens: number; orcado: number };
}

interface LinhaComJob {
  job: {
    id: string;
    codigo: string;
    nome: string;
    nome_financeiro: string | null;
    produto: string | null;
    valor_total: number | string | null;
    data_abertura_financeiro: string | null;
    aberto_por: string | null;
    projeto_financeiro_id: string | null;
    projeto: { codigo: string; nome: string; cliente: { nome_fantasia: string } | null } | null;
    responsavel: { nome: string } | null;
    regional: { nome: string } | null;
    projeto_financeiro: { codigo: string } | null;
  };
}

export async function listarCancelamentosNaFila(
  tenantId: string,
): Promise<CancelamentoNaFila[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("jobs_cancelamentos")
    .select(
      // `aberto_por` aponta para `auth.users`, não para `profiles`: o nome
      // vem numa leitura à parte, na segunda onda.
      `${SELECT_CANCELAMENTO}, job:jobs!inner(id, codigo, nome, nome_financeiro, produto, valor_total, data_abertura_financeiro, aberto_por, projeto_financeiro_id, ` +
        "projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia)), " +
        "responsavel:profiles!responsavel_id(nome), " +
        "regional:regionais(nome), projeto_financeiro:projetos_financeiro(codigo))",
    )
    .eq("tenant_id", tenantId)
    .eq("situacao", "pendente")
    .order("solicitado_em", { ascending: true });

  if (error) {
    console.error("[abertura.cancelamentos]", error.message);
    return [];
  }
  const linhas = (data ?? []) as unknown as (Parameters<typeof paraCancelamento>[0] & LinhaComJob)[];
  if (linhas.length === 0) return [];

  const jobIds = linhas.map((l) => l.job.id);
  const pfIds = [
    ...new Set(linhas.map((l) => l.job.projeto_financeiro_id).filter((id): id is string => !!id)),
  ];

  const abertoPorIds = [
    ...new Set(linhas.map((l) => l.job.aberto_por).filter((id): id is string => !!id)),
  ];

  const [recebRes, custoRes, impRes, itensRes, irmaosRes, abertoPorRes] = await Promise.all([
    supabase.from("jobs_previsao_recebimento").select("job_id, valor").in("job_id", jobIds),
    supabase.from("jobs_previsao_custo").select("job_id, valor").in("job_id", jobIds),
    supabase.from("jobs_previsao_impostos").select("job_id, valor").in("job_id", jobIds),
    supabase
      .from("jobs_itens_orcado")
      .select("job_id, grupo_id, job_grupo_id, total_orcado")
      .in("job_id", jobIds),
    pfIds.length > 0
      ? supabase
          .from("jobs")
          .select("id, projeto_financeiro_id")
          .eq("tenant_id", tenantId)
          .in("projeto_financeiro_id", pfIds)
          .neq("status", "cancelado")
      : Promise.resolve({ data: [] as { id: string; projeto_financeiro_id: string }[], error: null }),
    abertoPorIds.length > 0
      ? supabase.from("profiles").select("id, nome").in("id", abertoPorIds)
      : Promise.resolve({ data: [] as { id: string; nome: string }[], error: null }),
  ]);
  for (const [rotulo, res] of [
    ["receb", recebRes],
    ["custo", custoRes],
    ["impostos", impRes],
    ["itens", itensRes],
    ["irmaos", irmaosRes],
    ["aberto_por", abertoPorRes],
  ] as const) {
    if (res.error) console.error(`[abertura.cancelamentos.${rotulo}]`, res.error.message);
  }

  const somar = (rows: { job_id: string; valor: number | string }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.job_id, (m.get(r.job_id) ?? 0) + Number(r.valor ?? 0));
    return m;
  };
  const receb = somar(recebRes.data as { job_id: string; valor: number }[] | null);
  const custo = somar(custoRes.data as { job_id: string; valor: number }[] | null);
  const impostos = somar(impRes.data as { job_id: string; valor: number }[] | null);

  const planilha = new Map<string, { grupos: Set<string>; itens: number; orcado: number }>();
  for (const it of (itensRes.data ?? []) as {
    job_id: string;
    grupo_id: string | null;
    job_grupo_id: string | null;
    total_orcado: number | string | null;
  }[]) {
    const p = planilha.get(it.job_id) ?? { grupos: new Set<string>(), itens: 0, orcado: 0 };
    const grupo = it.job_grupo_id ?? it.grupo_id;
    if (grupo) p.grupos.add(grupo);
    p.itens += 1;
    p.orcado += Number(it.total_orcado ?? 0);
    planilha.set(it.job_id, p);
  }

  const vivosPorProjeto = new Map<string, number>();
  for (const j of (irmaosRes.data ?? []) as { id: string; projeto_financeiro_id: string }[]) {
    vivosPorProjeto.set(j.projeto_financeiro_id, (vivosPorProjeto.get(j.projeto_financeiro_id) ?? 0) + 1);
  }

  const nomePorId = new Map(
    ((abertoPorRes.data ?? []) as { id: string; nome: string }[]).map((p) => [p.id, p.nome]),
  );
  const centavos = (n: number) => Math.round(n * 100) / 100;

  return linhas.map((l) => {
    const j = l.job;
    const p = planilha.get(j.id);
    const pf = j.projeto_financeiro_id;
    return {
      pedido: paraCancelamento(l),
      jobId: j.id,
      codigo: j.codigo,
      nome: j.nome_financeiro?.trim() || j.nome,
      projetoCodigo: j.projeto?.codigo ?? null,
      projetoNome: j.projeto?.nome ?? null,
      clienteNome: j.projeto?.cliente?.nome_fantasia ?? null,
      produto: j.produto,
      responsavelNome: j.responsavel?.nome ?? null,
      regionalNome: j.regional?.nome ?? null,
      valorTotal: Number(j.valor_total ?? 0),
      abertoEm: j.data_abertura_financeiro,
      abertoPorNome: j.aberto_por ? nomePorId.get(j.aberto_por) ?? null : null,
      projetoFinanceiroCodigo: j.projeto_financeiro?.codigo ?? null,
      // O próprio job ainda está vivo: "outro" é mais de um.
      projetoFinanceiroFicaInativo: pf !== null && (vivosPorProjeto.get(pf) ?? 0) <= 1,
      recebimentoPrevisto: centavos(receb.get(j.id) ?? 0),
      custoPrevisto: centavos(custo.get(j.id) ?? 0),
      impostosPrevistos: centavos(impostos.get(j.id) ?? 0),
      planilha: {
        grupos: p?.grupos.size ?? 0,
        itens: p?.itens ?? 0,
        orcado: centavos(p?.orcado ?? 0),
      },
    };
  });
}
