import { createClient } from "@/lib/supabase/server";
import { nomeDoJobNoFinanceiro } from "@/lib/types";

/**
 * Um job aberto na visão do financeiro.
 *
 * O nome exibido é o `nome_financeiro` quando existe — é o ponto da tela:
 * o financeiro vê o nome dele, não o da produção (docs/decisions/004 e
 * HANDOFF_FINANCEIRO seção 3).
 *
 * Faturamento ficou de fora desta entrega de propósito: não existe dado
 * que diga se um job foi faturado, e chip de filtro ligado em campo
 * inexistente devolve zero linhas sempre — quem usa conclui que o dado
 * sumiu, não que a feature não existe.
 */
export interface JobAberto {
  id: string;
  codigo: string;
  /** Nome que o financeiro vê (financeiro, com fallback no da produção). */
  nome: string;
  /** Nome da produção, mostrado quando difere — some a dúvida de "que job é esse". */
  nome_producao: string;
  valor_total: number | null;
  data_abertura_financeiro: string | null;
  competencia_trimestre: number | null;
  competencia_ano: number | null;
  categoria_nome: string | null;
  empresa_nome: string | null;
  projeto_id: string;
  projeto_codigo: string | null;
  projeto_nome: string | null;
  cliente_nome: string | null;
  responsavel_nome: string | null;
  regional_nome: string | null;
  produto: string | null;
}

const SELECT_JOB_ABERTO =
  "id, codigo, nome, nome_financeiro, valor_total, data_abertura_financeiro, " +
  "competencia_trimestre, competencia_ano, projeto_id, produto, " +
  "categoria:categorias_dominio(nome), " +
  "empresa:empresas(razao_social, nome_fantasia), " +
  "regional:regionais(nome), " +
  "responsavel:profiles!responsavel_id(nome), " +
  "projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia))";

/**
 * Todos os jobs já abertos no financeiro, mais antigos primeiro pela data
 * de abertura. Uma query só, sem embed de itens: contagem e soma da lista
 * saem dos próprios campos do job (`docs/PERFORMANCE.md`).
 */
export async function listarJobsAbertos(
  tenantId: string,
): Promise<JobAberto[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("jobs")
    .select(SELECT_JOB_ABERTO)
    .eq("tenant_id", tenantId)
    .eq("status", "aberto")
    .order("codigo", { ascending: true });

  if (error) {
    console.error("[jobs-abertos.listar]", error.message);
    return [];
  }

  return ((data ?? []) as any[]).map((j) => ({
    id: j.id,
    codigo: j.codigo,
    nome: nomeDoJobNoFinanceiro(j),
    nome_producao: j.nome,
    valor_total: j.valor_total !== null ? Number(j.valor_total) : null,
    data_abertura_financeiro: j.data_abertura_financeiro,
    competencia_trimestre: j.competencia_trimestre,
    competencia_ano: j.competencia_ano,
    categoria_nome: j.categoria?.nome ?? null,
    empresa_nome: j.empresa?.nome_fantasia ?? j.empresa?.razao_social ?? null,
    projeto_id: j.projeto_id,
    projeto_codigo: j.projeto?.codigo ?? null,
    projeto_nome: j.projeto?.nome ?? null,
    cliente_nome: j.projeto?.cliente?.nome_fantasia ?? null,
    responsavel_nome: j.responsavel?.nome ?? null,
    regional_nome: j.regional?.nome ?? null,
    produto: j.produto,
  }));
}
