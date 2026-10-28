/**
 * Decisão 226 (28/10/2026): a versão aprovada do orçamento mostra o job.
 *
 * As erratas são combinadas com o cliente: depois da abertura, o que vale
 * para ele é a planilha do job (`jobs_itens_orcado` e `jobs_grupos`), não a
 * linha da versão que ele aprovou no início. A versão aprovada continua
 * gravada como foi — `guarda_orcamento_so_leitura` não muda —, e a tela e a
 * exportação passam a ler a planilha do job no lugar dela. A versão que o
 * cliente aprovou fica no Histórico (decisão 186 refeita para o orçamento).
 *
 * Ficam de fora a linha vermelha (não tem orçado, não é do cliente) e a
 * linha cancelada por errata. A Mídia Off continua lendo a versão: a planilha
 * dela tem conta própria e o job da mídia não faz errata (decisão 167).
 *
 * Os ids que saem são os das linhas e dos agrupamentos do JOB. Quem cruza
 * com dado da versão (BV, save) usa `idDaLinhaDoJob`.
 */
import type { createClient } from "@/lib/supabase/server";
import type {
  CategoriaModeloPlanilha,
  JobStatus,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
} from "@/lib/types";

type Supabase = ReturnType<typeof createClient>;

/** A versão mostra a planilha do job: é a aprovada, o job está vivo e não
 *  foi devolvido (aí a versão abre para correção, decisão 128), e o modelo
 *  não é Mídia Off. */
export function versaoMostraOJob(p: {
  versaoId: string;
  versaoAprovadaId: string | null;
  jobStatus: JobStatus | null;
  modelo: CategoriaModeloPlanilha;
}): boolean {
  return (
    p.versaoAprovadaId !== null &&
    p.versaoId === p.versaoAprovadaId &&
    p.jobStatus !== null &&
    p.jobStatus !== "cancelado" &&
    p.jobStatus !== "rejeitado_financeiro" &&
    p.modelo !== "midia_off"
  );
}

export interface PlanilhaDoJobNaVersao {
  jobId: string;
  grupos: VersaoOrcamentoGrupo[];
  itens: VersaoOrcamentoItem[];
  /** Id da linha da versão → id da linha do job que a copia. */
  idDaLinhaDoJob: Record<string, string>;
}

export async function planilhaDoJobNaVersao(
  supabase: Supabase,
  tenantId: string,
  jobId: string,
  versaoId: string,
): Promise<{ ok: true; planilha: PlanilhaDoJobNaVersao } | { ok: false; message: string }> {
  const [gruposRes, itensRes] = await Promise.all([
    supabase
      .from("jobs_grupos")
      .select("id, nome, ordem, mes_id, created_at, updated_at")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .is("removido_em", null)
      .order("ordem", { ascending: true }),
    supabase
      .from("jobs_itens_orcado")
      .select("*")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .eq("linha_vermelha", false)
      .is("cancelada_em", null)
      .order("ordem", { ascending: true }),
  ]);
  if (gruposRes.error || itensRes.error) {
    console.error("[versao.planilha_do_job]", gruposRes.error?.message ?? itensRes.error?.message);
    return { ok: false, message: "Não foi possível ler a planilha do job." };
  }

  const grupos: VersaoOrcamentoGrupo[] = (gruposRes.data ?? []).map((g) => ({
    id: g.id as string,
    tenant_id: tenantId,
    versao_orcamento_id: versaoId,
    nome: g.nome as string,
    ordem: Number(g.ordem ?? 0),
    mes_id: (g.mes_id as string | null) ?? null,
    meio: null,
    forma_compra: null,
    formato: null,
    created_at: g.created_at as string,
    updated_at: g.updated_at as string,
  }));

  const idDaLinhaDoJob: Record<string, string> = {};
  const itens: VersaoOrcamentoItem[] = ((itensRes.data ?? []) as Array<Record<string, unknown>>).map((l) => {
    if (l.item_versao_id) idDaLinhaDoJob[l.item_versao_id as string] = l.id as string;
    return {
      id: l.id as string,
      tenant_id: tenantId,
      versao_orcamento_id: versaoId,
      // O agrupamento é o do job (decisão 162): o nome e a ordem de hoje.
      grupo_id: l.job_grupo_id as string,
      ordem: Number(l.ordem ?? 0),
      planilha_origem: null,
      item: l.item as string,
      tipo_custo: l.tipo_custo as VersaoOrcamentoItem["tipo_custo"],
      valor_unitario_orcado: Number(l.valor_unitario_orcado ?? 0),
      quantidade_orcada: Number(l.quantidade_orcada ?? 0),
      dias_meses_orcado: Number(l.dias_meses_orcado ?? 0),
      total_orcado: Number(l.total_orcado ?? 0),
      categoria_id: (l.categoria_id as string | null) ?? null,
      valor_unitario_planejado: Number(l.valor_unitario_planejado ?? 0),
      quantidade_planejada: Number(l.quantidade_planejada ?? 0),
      dias_meses_planejado: Number(l.dias_meses_planejado ?? 0),
      total_planejado: Number(l.total_planejado ?? 0),
      bv_liquido_planejado: l.bv_liquido_planejado === null ? null : Number(l.bv_liquido_planejado),
      em_save: l.em_save === true,
      save_consumido: Number(l.save_consumido ?? 0),
      save_marcado_por: (l.save_marcado_por as string | null) ?? null,
      save_marcado_em: (l.save_marcado_em as string | null) ?? null,
      planejado_antes_save: (l.planejado_antes_save as VersaoOrcamentoItem["planejado_antes_save"]) ?? null,
      fornecedor_id: (l.fornecedor_id as string | null) ?? null,
      observacoes: null,
      praca: null,
      peca: null,
      formato: null,
      insercoes_por_dia: null,
      data_inicio: null,
      data_fim: null,
      unidade_periodo: null,
      valor_unitario_tabela: null,
      percentual_desconto: null,
      detalhe: null,
      created_at: l.created_at as string,
      updated_at: l.updated_at as string,
    };
  });

  return { ok: true, planilha: { jobId, grupos, itens, idDaLinhaDoJob } };
}
