/**
 * Leituras do pedido de cancelamento de job aberto (decisão 169).
 *
 * A tabela é `jobs_cancelamentos`; a escrita é só pelas funções
 * `*_cancelamento_do_job` do banco. Aqui ficam as leituras que mais de uma
 * tela usa: o pedido de um job (página do job, no módulo de Jobs e no
 * financeiro), os jobs com pedido no ar (as listas) e o pedido aprovado (o
 * rastro na página do orçamento).
 *
 * `jobs_cancelamentos` tem cinco FKs para `profiles`: todo embed de perfil
 * leva a dica da coluna (`profiles!solicitado_por`), senão o PostgREST
 * recusa a consulta inteira (docs/FLUXO-BANCO.md).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CancelamentoDoJob, SituacaoDoCancelamento } from "@/lib/types";

export const SELECT_CANCELAMENTO =
  "id, job_id, situacao, motivo, solicitado_em, retirado_em, decidido_em, justificativa, aviso_dispensado_em, " +
  "recebimento_previsto, custo_previsto, impostos_previstos, " +
  "solicitante:profiles!solicitado_por(nome), decisor:profiles!decidido_por(nome), retirador:profiles!retirado_por(nome), " +
  "projeto_inativado:projetos_financeiro!projeto_financeiro_inativado_id(codigo)";

interface LinhaCancelamento {
  id: string;
  job_id: string;
  situacao: SituacaoDoCancelamento;
  motivo: string;
  solicitado_em: string;
  retirado_em: string | null;
  decidido_em: string | null;
  justificativa: string | null;
  aviso_dispensado_em: string | null;
  recebimento_previsto: number | string | null;
  custo_previsto: number | string | null;
  impostos_previstos: number | string | null;
  solicitante: { nome: string } | null;
  decisor: { nome: string } | null;
  retirador: { nome: string } | null;
  projeto_inativado: { codigo: string } | null;
}

function numeroOuNulo(v: number | string | null): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export function paraCancelamento(r: LinhaCancelamento): CancelamentoDoJob {
  return {
    id: r.id,
    jobId: r.job_id,
    situacao: r.situacao,
    motivo: r.motivo,
    solicitadoPorNome: r.solicitante?.nome ?? "—",
    solicitadoEm: r.solicitado_em,
    retiradoEm: r.retirado_em,
    retiradoPorNome: r.retirador?.nome ?? null,
    decididoPorNome: r.decisor?.nome ?? null,
    decididoEm: r.decidido_em,
    justificativa: r.justificativa,
    avisoDispensadoEm: r.aviso_dispensado_em,
    recebimentoPrevisto: numeroOuNulo(r.recebimento_previsto),
    custoPrevisto: numeroOuNulo(r.custo_previsto),
    impostosPrevistos: numeroOuNulo(r.impostos_previstos),
    projetoFinanceiroInativadoCodigo: r.projeto_inativado?.codigo ?? null,
  };
}

/**
 * O pedido de UM job, como a página dele precisa: o que está no ar e a
 * recusa que a produção ainda não dispensou. A recusa só conta se for o
 * último pedido — pedir de novo, ou retirar, apaga a faixa dela.
 */
export async function cancelamentoDoJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<{ pendente: CancelamentoDoJob | null; recusaNaoVista: CancelamentoDoJob | null }> {
  const { data, error } = await supabase
    .from("jobs_cancelamentos")
    .select(SELECT_CANCELAMENTO)
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .order("solicitado_em", { ascending: false })
    .limit(1)
    .returns<LinhaCancelamento[]>();
  if (error) console.error("[cancelamento.do_job]", error.message);
  const ultimo = data?.[0] ? paraCancelamento(data[0]) : null;
  return {
    pendente: ultimo?.situacao === "pendente" ? ultimo : null,
    recusaNaoVista:
      ultimo?.situacao === "recusado" && ultimo.avisoDispensadoEm === null ? ultimo : null,
  };
}

/** O que trava o pedido agora, em texto para a tela, ou nulo. É a mesma
 *  conta que o banco faz no pedido e de novo na aprovação. */
export async function travaDoCancelamento(
  supabase: SupabaseClient,
  jobId: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("trava_do_cancelamento_do_job", {
    p_job_id: jobId,
  });
  if (error) {
    console.error("[cancelamento.trava]", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

/** Os jobs do tenant com pedido no ar — o selo das listas. Uma leitura
 *  só, coberta pelo índice parcial `idx_jobs_cancelamentos_pendentes`. */
export async function jobsComCancelamentoPendente(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("jobs_cancelamentos")
    .select("job_id")
    .eq("tenant_id", tenantId)
    .eq("situacao", "pendente")
    .returns<{ job_id: string }[]>();
  if (error) console.error("[cancelamento.pendentes]", error.message);
  return new Set((data ?? []).map((r) => r.job_id));
}

/** Os pedidos de um job, do mais antigo ao mais novo — o histórico do rastro
 *  na página do orçamento (o aprovado e o que veio antes dele). */
export async function historicoDeCancelamentos(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<CancelamentoDoJob[]> {
  const { data, error } = await supabase
    .from("jobs_cancelamentos")
    .select(SELECT_CANCELAMENTO)
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .order("solicitado_em", { ascending: true })
    .returns<LinhaCancelamento[]>();
  if (error) console.error("[cancelamento.historico]", error.message);
  return (data ?? []).map(paraCancelamento);
}

// ---------- O rastro na página do orçamento ----------

/** Um passo do histórico do rastro, já em texto. */
export interface EventoDoRastro {
  /** ISO. */
  em: string;
  texto: string;
  /** Quem fez, quando for alguém da produção. As decisões do financeiro
   *  saem sem o nome, como a devolução da abertura (decisão 136). */
  por: string | null;
}

/** O que a faixa "Job cancelado" do orçamento mostra (decisão 169). */
export interface RastroDoCancelamento {
  jobCodigo: string;
  /** ISO da aprovação. Nulo no cancelamento feito antes de o pedido existir
   *  no sistema (o ANI-1004/26, pelo MCP). */
  canceladoEm: string | null;
  motivo: string | null;
  observacao: string | null;
  eventos: EventoDoRastro[];
  /** A foto da aprovação; nula no cancelamento de antes do pedido. */
  saida: {
    recebimento: number;
    custo: number;
    impostos: number;
    projetoFinanceiroInativado: string | null;
  } | null;
}

/**
 * Monta o rastro do job cancelado depois da abertura: a abertura, cada
 * pedido (retirado, recusado e o aprovado) e as PPs canceladas do job, em
 * ordem de tempo. Duas leituras em paralelo.
 */
export async function montarRastroDoCancelamento(
  supabase: SupabaseClient,
  tenantId: string,
  job: { id: string; codigo: string; data_abertura_financeiro: string | null },
): Promise<RastroDoCancelamento> {
  const [historico, ppsRes] = await Promise.all([
    historicoDeCancelamentos(supabase, tenantId, job.id),
    supabase
      .from("pedidos_compra")
      .select("codigo, cancelada_em, cancelador:profiles!cancelada_por(nome)")
      .eq("job_id", job.id)
      .eq("tenant_id", tenantId)
      .eq("status", "cancelada")
      .not("cancelada_em", "is", null)
      .order("cancelada_em", { ascending: true })
      .returns<{ codigo: string; cancelada_em: string; cancelador: { nome: string } | null }[]>(),
  ]);
  if (ppsRes.error) console.error("[cancelamento.rastro.pps]", ppsRes.error.message);

  const eventos: EventoDoRastro[] = [];
  if (job.data_abertura_financeiro) {
    eventos.push({ em: job.data_abertura_financeiro, texto: "Job aberto pelo financeiro", por: null });
  }
  for (const p of historico) {
    eventos.push({ em: p.solicitadoEm, texto: "Cancelamento solicitado", por: p.solicitadoPorNome });
    if (p.situacao === "retirado" && p.retiradoEm) {
      eventos.push({ em: p.retiradoEm, texto: "Pedido retirado pela produção", por: p.retiradoPorNome });
    }
    if (p.situacao === "recusado" && p.decididoEm) {
      eventos.push({
        em: p.decididoEm,
        texto: p.justificativa
          ? `Cancelamento recusado pelo Financeiro · “${p.justificativa}”`
          : "Cancelamento recusado pelo Financeiro",
        por: null,
      });
    }
    if (p.situacao === "aprovado" && p.decididoEm) {
      eventos.push({ em: p.decididoEm, texto: "Cancelamento aprovado pelo Financeiro", por: null });
    }
  }

  // As PPs canceladas juntas (no mesmo minuto, pela mesma pessoa) viram uma
  // linha só — é o "Cancelar as N PPs" do pop-up do pedido.
  const grupos: { em: string; chave: string; codigos: string[]; por: string | null }[] = [];
  for (const pp of ppsRes.data ?? []) {
    const por = pp.cancelador?.nome ?? null;
    const chave = `${pp.cancelada_em.slice(0, 16)}|${por ?? ""}`;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.chave === chave) ultimo.codigos.push(pp.codigo);
    else grupos.push({ em: pp.cancelada_em, chave, codigos: [pp.codigo], por });
  }
  for (const g of grupos) {
    eventos.push({
      em: g.em,
      texto:
        g.codigos.length === 1
          ? `PP cancelada · ${g.codigos[0]}`
          : `PPs canceladas · ${g.codigos.join(", ")}`,
      por: g.por,
    });
  }
  eventos.sort((a, b) => a.em.localeCompare(b.em));

  const aprovado = [...historico].reverse().find((p) => p.situacao === "aprovado") ?? null;
  return {
    jobCodigo: job.codigo,
    canceladoEm: aprovado?.decididoEm ?? null,
    motivo: aprovado?.motivo ?? null,
    observacao: aprovado?.justificativa ?? null,
    eventos,
    saida: aprovado
      ? {
          recebimento: aprovado.recebimentoPrevisto ?? 0,
          custo: aprovado.custoPrevisto ?? 0,
          impostos: aprovado.impostosPrevistos ?? 0,
          projetoFinanceiroInativado: aprovado.projetoFinanceiroInativadoCodigo,
        }
      : null,
  };
}
