import { createClient } from "@/lib/supabase/server";
import {
  competenciaLabel,
  jobStatusExibido,
  nomeDoJobNoFinanceiro,
  type JobStatus,
  type JobStatusExibido,
} from "@/lib/types";

/**
 * Projeto na visão do financeiro (`projetos_financeiro`).
 *
 * Não é o projeto da produção. `jobs.projeto_id` continua nascendo do
 * orçamento e mandando em Orçamentos e na página de Jobs; este aqui é a
 * arrumação que o financeiro faz dos jobs dele, e a produção nunca vê —
 * mesmo contrato de `jobs.nome_financeiro` vs `jobs.nome`.
 *
 * A tabela nasceu espelhando `projetos` (backfill da migration
 * 20260820000011) para o combo não abrir vazio; a partir dali as duas
 * arrumações divergem à vontade.
 */
export interface ProjetoFinanceiroOpcao {
  id: string;
  codigo: string;
  nome: string;
  /** O cliente de quem criou o projeto — o do primeiro job. */
  cliente_id: string;
  cliente_nome: string | null;
  /**
   * Os clientes dos jobs do projeto, sem repetir. Desde a decisão 228 um
   * projeto do financeiro junta jobs de clientes diferentes (os parceiros
   * de um mesmo evento), e o cliente de quem criou não diz mais quem está
   * dentro. Vazio só no projeto novo, que ainda não tem job.
   */
  clientes: { id: string; nome: string | null }[];
  /**
   * As empresas dos jobs do projeto, fora o job que está sendo aberto: o
   * campo só oferece os projetos da empresa escolhida no job (revisão da
   * 228, 30/10/2026). Vazio quando o projeto só tem este job — aí ele não
   * prende a empresa.
   */
  empresas: string[];
  /**
   * Os jobs que já estão no projeto, fora o que está sendo aberto, na
   * ordem de criação: o campo abre a lista deles e o painel "Ver todos os
   * projetos unificados" mostra a mesma coisa (decisão 228, 30/10/2026).
   */
  jobs: JobDoProjetoUnificado[];
}

export interface JobDoProjetoUnificado {
  id: string;
  codigo: string;
  /** O nome que o financeiro vê. */
  nome: string;
  cliente: string | null;
  /** `jobs.valor_total`, o valor do job. */
  valor: number;
  status: JobStatusExibido;
  /** "4T/2026", ou "—" sem competência. */
  competencia: string;
}

/**
 * Todos os projetos do financeiro ativos, para o combo da abertura e do
 * registro.
 *
 * Até 29/10/2026 a lista vinha filtrada pelo cliente do job, e o nome é
 * único no sistema inteiro (decisão 119): o job de um parceiro de evento
 * não achava o projeto do evento e não podia criar outro com o mesmo
 * nome — "Fair Culture & Business" virou dez projetos, um por cliente.
 * Agora a busca acha qualquer projeto aberto (decisão 228); os do cliente
 * do job (`clienteDoJob`) vêm primeiro, e cada linha mostra os clientes
 * que já estão dentro. A lista vem inteira, com as empresas de cada
 * projeto (`jobId` fica de fora da conta): quem filtra pela empresa é o
 * formulário, porque a empresa do job se troca ali mesmo.
 */
export async function listarProjetosFinanceiro(
  tenantId: string,
  clienteDoJob: string | null,
  jobId: string,
): Promise<ProjetoFinanceiroOpcao[]> {
  const supabase = createClient();

  // Independentes — em paralelo (`docs/PERFORMANCE.md`). Os clientes, as
  // empresas e os jobs de cada projeto vêm de uma consulta só aos jobs, à
  // parte, e não num embed por projeto.
  const [projetosRes, jobsRes] = await Promise.all([
    supabase
      .from("projetos_financeiro")
      .select("id, codigo, nome, cliente_id, cliente:clientes(nome_fantasia)")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      // Pela criação: era pelo código, que saiu das telas (27/10/2026) e
      // dava a mesma ordem dentro do ano.
      .order("created_at", { ascending: true }),
    supabase
      .from("jobs")
      .select(
        "id, codigo, nome, nome_financeiro, status, faturamento_enviado_em, valor_total, " +
          "competencia_trimestre, competencia_ano, projeto_financeiro_id, cliente_id, empresa_id, " +
          "cliente:clientes!jobs_cliente_id_fkey(nome_fantasia)",
      )
      .eq("tenant_id", tenantId)
      .not("projeto_financeiro_id", "is", null)
      // Job cancelado ou reprovado não existe no financeiro.
      .not("status", "in", "(cancelado,rejeitado_financeiro)")
      .order("created_at", { ascending: true }),
  ]);

  if (projetosRes.error) {
    console.error("[projetos-financeiro.listar]", projetosRes.error.message);
    return [];
  }
  if (jobsRes.error) {
    console.error("[projetos-financeiro.clientes]", jobsRes.error.message);
  }

  const clientesPorProjeto = new Map<string, Map<string, string | null>>();
  const empresasPorProjeto = new Map<string, Set<string>>();
  const jobsPorProjeto = new Map<string, JobDoProjetoUnificado[]>();
  for (const j of (jobsRes.data ?? []) as any[]) {
    if (j.id !== jobId) {
      if (j.empresa_id) {
        const doProjeto = empresasPorProjeto.get(j.projeto_financeiro_id) ?? new Set<string>();
        doProjeto.add(j.empresa_id);
        empresasPorProjeto.set(j.projeto_financeiro_id, doProjeto);
      }
      const jobs = jobsPorProjeto.get(j.projeto_financeiro_id) ?? [];
      jobs.push({
        id: j.id,
        codigo: j.codigo,
        nome: nomeDoJobNoFinanceiro(j),
        cliente: j.cliente?.nome_fantasia ?? null,
        valor: Number(j.valor_total ?? 0),
        status: jobStatusExibido(j.status as JobStatus, j.faturamento_enviado_em ?? null),
        competencia: competenciaLabel(j.competencia_trimestre, j.competencia_ano),
      });
      jobsPorProjeto.set(j.projeto_financeiro_id, jobs);
    }
    if (!j.cliente_id) continue;
    const doProjeto =
      clientesPorProjeto.get(j.projeto_financeiro_id) ?? new Map();
    if (!doProjeto.has(j.cliente_id)) {
      doProjeto.set(j.cliente_id, j.cliente?.nome_fantasia ?? null);
    }
    clientesPorProjeto.set(j.projeto_financeiro_id, doProjeto);
  }

  const lista = ((projetosRes.data ?? []) as any[]).map((p) => {
    const dosJobs = clientesPorProjeto.get(p.id);
    return {
      id: p.id as string,
      codigo: p.codigo as string,
      nome: p.nome as string,
      cliente_id: p.cliente_id as string,
      cliente_nome: (p.cliente?.nome_fantasia as string | undefined) ?? null,
      clientes: dosJobs
        ? Array.from(dosJobs, ([id, nome]) => ({ id, nome }))
        : [
            {
              id: p.cliente_id as string,
              nome: (p.cliente?.nome_fantasia as string | undefined) ?? null,
            },
          ],
      empresas: Array.from(empresasPorProjeto.get(p.id) ?? []),
      jobs: jobsPorProjeto.get(p.id) ?? [],
    };
  });

  if (!clienteDoJob) return lista;
  // Os do cliente do job primeiro, cada metade na ordem de criação.
  const doCliente = (p: ProjetoFinanceiroOpcao) =>
    p.cliente_id === clienteDoJob ||
    p.clientes.some((c) => c.id === clienteDoJob);
  return [...lista.filter(doCliente), ...lista.filter((p) => !doCliente(p))];
}
