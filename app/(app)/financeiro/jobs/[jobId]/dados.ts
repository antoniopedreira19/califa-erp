import { createClient } from "@/lib/supabase/server";
import {
  contatosDeCobrancaDoJob,
  type ContatoCobranca,
} from "@/lib/data/contatos-cobranca";
import { nomeDoJobNoFinanceiro, type PPStatus } from "@/lib/types";
import { realizadoBrutoDoItem } from "@/lib/calculos/bv-planilha";

/** Uma data da curva de desembolso, como foi gravada na abertura. */
export interface PrevisaoDoJob {
  id: string;
  ordem: number;
  data_prevista: string;
  valor: number;
}

/** Um Pedido de Produção do job, com o fornecedor resolvido. */
export interface PpDoJob {
  id: string;
  codigo: string;
  fornecedor_nome: string | null;
  valor: number;
  status: PPStatus;
}

export interface JobNoFinanceiro {
  id: string;
  codigo: string;
  /** Nome que o financeiro vê. */
  nome: string;
  nome_producao: string;
  status: string;
  valor_total: number;
  faturamento_previsto: number | null;
  valor_job_abertura: number | null;
  faturamento_previsto_abertura: number | null;
  custo_previsto_total: number | null;
  competencia_trimestre: number | null;
  competencia_ano: number | null;
  categoria_nome: string | null;
  data_abertura_financeiro: string | null;
  aberto_por_nome: string | null;
  produto: string | null;
  cidade: string | null;
  regional_nome: string | null;
  responsavel_nome: string | null;
  produtor_nome: string | null;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
  data_prevista_faturamento: string | null;
  observacoes: string | null;
  empresa_nome: string | null;
  projeto_id: string;
  projeto_codigo: string | null;
  projeto_nome: string | null;
  cliente_nome: string | null;
  orcamento_id: string;
  orcamento_codigo: string | null;
  versao_numero: number | null;
  moeda: string;
  /** Soma do planejado de TODOS os itens — controle interno da planilha. */
  planejado_total: number;
  /** Soma do realizado lançado até agora. */
  realizado_total: number;
}

const SELECT_JOB =
  "id, codigo, nome, nome_financeiro, status, valor_total, faturamento_previsto, " +
  "valor_job_abertura, faturamento_previsto_abertura, custo_previsto_total, " +
  "competencia_trimestre, competencia_ano, data_abertura_financeiro, produto, cidade, " +
  "data_inicio_prevista, data_fim_prevista, data_prevista_faturamento, observacoes, " +
  "projeto_id, orcamento_id, " +
  "categoria:categorias_dominio(nome), " +
  "empresa:empresas(razao_social, nome_fantasia), " +
  "regional:regionais(nome), " +
  "responsavel:profiles!responsavel_id(nome), " +
  "produtor:profiles!produtor_id(nome), " +
  // `aberto_por` NÃO entra como embed: a FK aponta para `auth.users`, e
  // não para `profiles`, então o PostgREST não enxerga relação por ali.
  // O nome é buscado numa consulta à parte (profiles.id == auth.users.id).
  "aberto_por, " +
  "projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia)), " +
  "orcamento:orcamentos(codigo), " +
  "versao:versoes_orcamento!versao_orcamento_aprovada_id(numero_versao, moeda)";

export interface DadosDoJobFinanceiro {
  job: JobNoFinanceiro;
  previsoes: PrevisaoDoJob[];
  pps: PpDoJob[];
  /** Quem cobrar. Vazio nos jobs anteriores a 17/08/2026
   *  (docs/decisions/012). */
  contatos: ContatoCobranca[];
}

/**
 * Tudo que a visão financeira do job precisa, em três queries paralelas.
 *
 * Os totais de planejado e realizado saem de uma query agregada sobre os
 * itens, e não de um embed do job — embed de itens só para somar é o
 * anti-padrão que `docs/PERFORMANCE.md` proíbe.
 */
export async function carregarJobNoFinanceiro(
  tenantId: string,
  jobId: string,
): Promise<DadosDoJobFinanceiro | null> {
  const supabase = createClient();

  const [jobRes, previsoesRes, ppsRes, itensRes] = await Promise.all([
    supabase
      .from("jobs")
      .select(SELECT_JOB)
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("jobs_previsao_custo")
      .select("id, ordem, data_prevista, valor")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .order("ordem", { ascending: true }),
    supabase
      .from("pedidos_compra")
      .select("id, codigo, valor, status, fornecedor:fornecedores(nome)")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .order("codigo", { ascending: true }),
    supabase
      .from("jobs_itens_orcado")
      .select("total_planejado")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
  ]);

  if (jobRes.error) console.error("[financeiro.job]", jobRes.error.message);
  const raw = jobRes.data as any;
  if (!raw) return null;

  const planejadoTotal = (itensRes.data ?? []).reduce(
    (s, i: { total_planejado: number | string | null }) =>
      s + Number(i.total_planejado ?? 0),
    0,
  );

  // Realizado vive em outra tabela; e quem abriu vem de `profiles` por id,
  // já que a FK de `aberto_por` aponta para `auth.users`. As duas não
  // dependem uma da outra — vão juntas.
  const [realizadosRes, abertoPorRes, contatos] = await Promise.all([
    // Não basta somar `total_realizado`: desde 21/08/2026 ele é a soma das
    // PPs, e item `A`/`D` (que não gera PP) fica em zero — o realizado
    // deles é o ORÇADO, substituído na leitura. Somar a coluna crua
    // zeraria toda linha de custo A do job (docs/decisions/022).
    supabase
      .from("jobs_itens_orcado")
      .select(
        "item_versao_id, tipo_custo, total_orcado, em_save, " +
          "realizado:jobs_itens_realizado!inner(total_realizado)",
      )
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    raw.aberto_por
      ? supabase
          .from("profiles")
          .select("nome")
          .eq("id", raw.aberto_por)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    contatosDeCobrancaDoJob(jobId, tenantId),
  ]);

  const realizadoTotal = (realizadosRes.data ?? []).reduce(
    (s: number, i: any) =>
      s +
      realizadoBrutoDoItem(
        i.tipo_custo,
        Number(i.total_orcado ?? 0),
        // O embed é `!inner` e 1:1, mas o PostgREST devolve objeto ou
        // array conforme a inferência da FK — normalizar aqui evita um
        // NaN silencioso somando o job inteiro.
        Number(
          (Array.isArray(i.realizado) ? i.realizado[0] : i.realizado)
            ?.total_realizado ?? 0,
        ),
        // Job na fila de abertura não tem realizado — nem o do orçado nas
        // linhas `A` e `D`. Encerrado continua tendo: é histórico.
        raw.status !== "aguardando_abertura" &&
          raw.status !== "rejeitado_financeiro",
        // Linha em save não tem custo neste job — nem o espelho do orçado
        // dos tipos `A` e `D` (decisão 023 §9).
        i.em_save === true,
      ),
    0,
  );

  return {
    job: {
      id: raw.id,
      codigo: raw.codigo,
      nome: nomeDoJobNoFinanceiro(raw),
      nome_producao: raw.nome,
      status: raw.status,
      valor_total: Number(raw.valor_total ?? 0),
      faturamento_previsto:
        raw.faturamento_previsto !== null &&
        raw.faturamento_previsto !== undefined
          ? Number(raw.faturamento_previsto)
          : null,
      valor_job_abertura:
        raw.valor_job_abertura !== null && raw.valor_job_abertura !== undefined
          ? Number(raw.valor_job_abertura)
          : null,
      faturamento_previsto_abertura:
        raw.faturamento_previsto_abertura !== null &&
        raw.faturamento_previsto_abertura !== undefined
          ? Number(raw.faturamento_previsto_abertura)
          : null,
      custo_previsto_total:
        raw.custo_previsto_total !== null &&
        raw.custo_previsto_total !== undefined
          ? Number(raw.custo_previsto_total)
          : null,
      competencia_trimestre: raw.competencia_trimestre,
      competencia_ano: raw.competencia_ano,
      categoria_nome: raw.categoria?.nome ?? null,
      data_abertura_financeiro: raw.data_abertura_financeiro,
      aberto_por_nome: (abertoPorRes.data as any)?.nome ?? null,
      produto: raw.produto,
      cidade: raw.cidade,
      regional_nome: raw.regional?.nome ?? null,
      responsavel_nome: raw.responsavel?.nome ?? null,
      produtor_nome: raw.produtor?.nome ?? null,
      data_inicio_prevista: raw.data_inicio_prevista,
      data_fim_prevista: raw.data_fim_prevista,
      data_prevista_faturamento: raw.data_prevista_faturamento,
      observacoes: raw.observacoes,
      empresa_nome:
        raw.empresa?.nome_fantasia ?? raw.empresa?.razao_social ?? null,
      projeto_id: raw.projeto_id,
      projeto_codigo: raw.projeto?.codigo ?? null,
      projeto_nome: raw.projeto?.nome ?? null,
      cliente_nome: raw.projeto?.cliente?.nome_fantasia ?? null,
      orcamento_id: raw.orcamento_id,
      orcamento_codigo: raw.orcamento?.codigo ?? null,
      versao_numero: raw.versao?.numero_versao ?? null,
      moeda: raw.versao?.moeda ?? "BRL",
      planejado_total: planejadoTotal,
      realizado_total: realizadoTotal,
    },
    previsoes: (previsoesRes.data ?? []).map((p: any) => ({
      id: p.id,
      ordem: p.ordem,
      data_prevista: p.data_prevista,
      valor: Number(p.valor ?? 0),
    })),
    pps: (ppsRes.data ?? []).map((p: any) => ({
      id: p.id,
      codigo: p.codigo,
      fornecedor_nome: p.fornecedor?.nome ?? null,
      valor: Number(p.valor ?? 0),
      status: p.status as PPStatus,
    })),
    contatos,
  };
}
