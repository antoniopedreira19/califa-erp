/**
 * Aprovação de save no financeiro — as contas e leituras que a abertura,
 * a aprovação e a recusa dividem (decisão 099, 22/09/2026).
 *
 * Módulo comum, sem `"use server"`, pelo mesmo motivo de `fotos.ts`: quem
 * grava são as Server Actions (`actions.ts`, `save-actions.ts`) e quem lê
 * é a página do job no financeiro. Em arquivo `"use server"` toda export
 * viraria Server Action.
 *
 * Os números do financeiro saem SEMPRE de `lib/data/espelhos-do-job.ts`
 * (`lerBaseDosEspelhos` → `totaisDoFinanceiro` → `espelhosDe`): é a única
 * conta dos espelhos do job, e a do banco (`vw_itens_orcado_financeiro`)
 * bate com ela.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  espelhosDe,
  lerBaseDosEspelhos,
  totaisDoFinanceiro,
  totaisParaRpc,
  type BaseDosEspelhos,
  type EspelhosDoJob,
  type LinhaDoEspelho,
  type TotaisParaRpc,
} from "@/lib/data/espelhos-do-job";
import { pedidosParaFinanceiroDoJob } from "@/lib/data/saves";
import { tipoGeraDesembolso } from "@/lib/calculos/versao-totais";
import type {
  OrigemDeSave,
  PlanejadoAntesDoSave,
  SaveAprovacaoMomento,
  SaveAprovacaoTipo,
  TipoCusto,
} from "@/lib/types";
import { formatDataHoraBr } from "./formatos";

/** Os números antes → depois que o pedido guarda (`p_numeros`). */
export interface NumerosDoPedido {
  valor_job_antes: number;
  valor_job_depois: number;
  faturamento_previsto_antes: number;
  faturamento_previsto_depois: number;
}

/**
 * A linha do job sem o save: a que gera deixa de ser save, a que consome
 * volta a `consumoAntes` (zero quando não havia consumo antes do pedido).
 */
export function linhaSemOSave(
  itens: LinhaDoEspelho[],
  linhaId: string,
  tipo: SaveAprovacaoTipo,
  consumoAntes: number,
): LinhaDoEspelho[] {
  return itens.map((i) => {
    if (i.id !== linhaId) return i;
    return tipo === "gera"
      ? { ...i, em_save: false }
      : { ...i, save_consumido: consumoAntes };
  });
}

/**
 * Os números de cada linha com save ou consumo do job, para o
 * `save_enviar_pendentes` da abertura: "depois" é o job como está (o
 * financeiro acabou de conferir estes números), "antes" é o mesmo job sem
 * o save daquela linha. É o efeito do save, que o pop-up de aprovação
 * mostra.
 */
export function numerosDasLinhasComSave(
  base: BaseDosEspelhos,
): Record<string, NumerosDoPedido> {
  const depois = espelhosDe(totaisDoFinanceiro(base.itens, base));
  const saida: Record<string, NumerosDoPedido> = {};
  for (const l of base.itens) {
    const gera = l.em_save;
    if (!gera && l.save_consumido <= 0) continue;
    const antes = espelhosDe(
      totaisDoFinanceiro(
        linhaSemOSave(base.itens, l.id, gera ? "gera" : "consome", 0),
        base,
      ),
    );
    saida[l.id] = {
      valor_job_antes: antes.valor_total,
      valor_job_depois: depois.valor_total,
      faturamento_previsto_antes: antes.faturamento_previsto,
      faturamento_previsto_depois: depois.faturamento_previsto,
    };
  }
  return saida;
}

/**
 * O CUSTO PREVISTO do job como o FINANCEIRO vê (decisão 099): o planejado
 * dos tipos que geram PP (docs/decisions/004), com os pedidos de save que
 * ele ainda não conta desfeitos na conta.
 *
 * Marcar save zera o planejado da linha na hora — é a produção vendo o
 * pedido imediatamente. Se o custo previsto saísse do `total_planejado`
 * cru, um save que AINDA AGUARDA sumiria do custo gravado na abertura, e
 * uma recusa depois deixaria a curva de desembolso menor que o custo real,
 * sem aviso nenhum. Por isso a linha com pedido `gera` `job_aberto`
 * aguardando volta com o planejado de antes do save
 * (`planejado_antes_save`), que é o que o trigger devolveria numa recusa.
 *
 * `aprovando` é o pedido que a revisão está aprovando: ele JÁ conta como
 * save (a linha fica sem planejado), e por isso fica de fora da devolução.
 *
 * Consumo não entra: consumir saldo não mexe no planejado da linha.
 */
export async function custoPrevistoDoFinanceiro(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  aprovando: string | null,
): Promise<{ ok: true; custo: number } | { ok: false; message: string }> {
  // As duas leituras são independentes: vão juntas (docs/PERFORMANCE.md).
  const [itensRes, pedidosRes] = await Promise.all([
    supabase
      .from("jobs_itens_orcado")
      .select("id, tipo_custo, total_planejado, planejado_antes_save")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    pedidosParaFinanceiroDoJob(supabase, tenantId, jobId).then(
      (p) => ({ ok: true as const, p }),
      (e: Error) => ({ ok: false as const, e }),
    ),
  ]);
  if (itensRes.error || !itensRes.data) {
    console.error("[abertura-job.custo-previsto]", itensRes.error?.message);
    return { ok: false, message: "Não foi possível ler a planilha do job." };
  }
  if (!pedidosRes.ok) {
    console.error(pedidosRes.e.message);
    return {
      ok: false,
      message: "Não foi possível ler os pedidos de save do job.",
    };
  }

  const devolver = new Set<string>();
  for (const pedido of pedidosRes.p) {
    if (
      pedido.situacao === "aguardando" &&
      pedido.momento === "job_aberto" &&
      pedido.tipo === "gera" &&
      pedido.jobItemOrcadoId &&
      pedido.id !== aprovando
    ) {
      devolver.add(pedido.jobItemOrcadoId);
    }
  }

  let custo = 0;
  for (const linha of itensRes.data as {
    id: string;
    tipo_custo: TipoCusto;
    total_planejado: number | string | null;
    planejado_antes_save: PlanejadoAntesDoSave | null;
  }[]) {
    if (!tipoGeraDesembolso(linha.tipo_custo)) continue;
    if (devolver.has(linha.id)) {
      const antes = linha.planejado_antes_save;
      // Linha marcada como save sem planejado nenhum não guardou nada:
      // zero é o valor certo, e é o que ela já valia.
      custo += antes
        ? Number(antes.valor_unitario ?? 0) *
          Number(antes.quantidade ?? 0) *
          Number(antes.dias_meses ?? 0)
        : 0;
      continue;
    }
    custo += Number(linha.total_planejado ?? 0);
  }
  return { ok: true, custo: Math.round(custo * 100) / 100 };
}

/**
 * Houve devolução deste job antes (rejeitado pelo financeiro e reenviado)?
 * Decide o `momento` do pedido na abertura: 'reenvio' ou 'abertura'.
 *
 * ⚠️ Melhor esforço. O job não guarda a devolução: `motivo_rejeicao` é
 * apagado no reenvio. O que sobra é a auditoria, que o administrador lê
 * inteira mas o financeiro só lê nos PRÓPRIOS eventos (policy
 * `audit_events_select_self`). Um financeiro que abre job devolvido por
 * outra pessoa grava 'abertura'. O momento é só rótulo do histórico: os
 * dois contam igual para o financeiro e se decidem igual.
 */
export async function jobJaFoiDevolvido(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("audit_events")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("entidade_tipo", "job")
    .eq("entidade_id", jobId)
    .in("acao", ["job.abertura_rejeitada", "job.reenviado_para_aprovacao"])
    .limit(1);
  if (error) {
    console.error("[abertura-job.devolvido]", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * Enfileira os saves e consumos do job que acabou de ser aberto
 * (`save_enviar_pendentes`, decisão 099): cada linha vira um pedido na
 * faixa Saves. Chamar DEPOIS de o job estar `aberto` — a RPC recusa antes.
 *
 * Devolve quantos pedidos nasceram, ou a mensagem do problema. Quem chama
 * não desfaz a abertura por isso.
 */
export async function enfileirarSavesDoJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  momento: "abertura" | "reenvio",
): Promise<{ ok: true; quantidade: number } | { ok: false; message: string }> {
  const lida = await lerBaseDosEspelhos(supabase, tenantId, jobId);
  if (!lida.ok) return { ok: false, message: lida.message };
  const numeros = numerosDasLinhasComSave(lida.base);
  // Sem save nem consumo no job, não há o que enfileirar — e a RPC não
  // precisa ser chamada.
  if (Object.keys(numeros).length === 0) return { ok: true, quantidade: 0 };

  const { data, error } = await supabase.rpc("save_enviar_pendentes", {
    p_job_id: jobId,
    p_momento: momento,
    p_numeros: numeros,
  });
  if (error) {
    console.error("[abertura-job.saves-enfileirar]", error.message);
    return { ok: false, message: error.message };
  }
  return { ok: true, quantidade: Number(data ?? 0) };
}

/**
 * O pedido que a página do job no financeiro está aprovando
 * (`?aprovarSave=<id>`): a faixa "Aprovação de save · revisão da
 * abertura" e os números que o formulário mostra e valida.
 */
export interface AprovacaoDeSave {
  pedidoId: string;
  /** A linha do pedido (`jobs_itens_orcado.id`) — é ela que a planilha do
   *  job destaca na aba Planilha Interna (decisão 099). `null` quando a
   *  linha foi removida: aí não há o que destacar, e a RPC já recusa a
   *  decisão do pedido. */
  linhaId: string | null;
  tipo: SaveAprovacaoTipo;
  momento: SaveAprovacaoMomento;
  itemDescricao: string;
  grupoNome: string | null;
  valor: number;
  /** Consome: as origens pedidas, maior primeiro. Gera: `[]`. */
  origens: { jobId: string; codigo: string; valor: number }[];
  enviadoPorNome: string | null;
  /** "22/09/2026 · 14:05" — pronto, calculado no servidor. */
  enviadoEmLabel: string;
  /** A errata de save que o pedido gerou (só `job_aberto`): a faixa não a
   *  repete na lista de erratas, porque a linha do save já é ela. */
  errataId: string | null;
  /** Os números gravados no pedido (antes → depois). */
  valorJobAntes: number | null;
  valorJobDepois: number | null;
  faturamentoPrevistoAntes: number | null;
  faturamentoPrevistoDepois: number | null;
  /**
   * Os espelhos do job DEPOIS da aprovação — o que o formulário mostra e
   * valida. No `job_aberto` saem da conta com este pedido contado
   * (`contar = [id]`; os outros que aguardam seguem de fora); nos outros
   * momentos o financeiro já contava a linha, e são os espelhos de hoje.
   */
  depois: EspelhosDoJob;
}

/** Os espelhos do job depois de aprovar o pedido — a mesma conta que a
 *  página mostra e a action grava. `null` quando não há o que regravar
 *  (pedido de outro momento: o financeiro já contava a linha). */
export async function espelhosDaAprovacao(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  pedidoId: string,
  momento: SaveAprovacaoMomento,
): Promise<{ ok: true; totais: TotaisParaRpc | null } | { ok: false; message: string }> {
  if (momento !== "job_aberto") return { ok: true, totais: null };
  const lida = await lerBaseDosEspelhos(supabase, tenantId, jobId);
  if (!lida.ok) return { ok: false, message: lida.message };
  // No mensal leva junto a parte de save dos meses já enviados.
  return { ok: true, totais: totaisParaRpc(lida.base.itens, lida.base, [pedidoId]) };
}

/**
 * Lê o pedido para a página do job. `null` sem `?aprovarSave=`;
 * `{ ok: false }` quando o id não é de um pedido deste job que ainda
 * aguarda — link velho, ou decidido por outra pessoa.
 */
export async function carregarAprovacaoDeSave(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  pedidoId: string | undefined,
): Promise<{ ok: true; aprovacao: AprovacaoDeSave } | { ok: false } | null> {
  if (!pedidoId) return null;
  const { data: p, error } = await supabase
    .from("saves_aprovacoes")
    .select(
      "id, job_id, job_item_orcado_id, situacao, tipo, momento, item_descricao, grupo_nome, valor, origens, enviado_por, enviado_em, errata_id, valor_job_antes, valor_job_depois, faturamento_previsto_antes, faturamento_previsto_depois",
    )
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .eq("job_id", jobId)
    .maybeSingle<any>();
  if (error) console.error("[abertura-job.aprovacao-save]", error.message);
  if (!p || p.situacao !== "aguardando") return { ok: false };

  const origens = (p.origens ?? []) as OrigemDeSave[];
  const idsOrigem = [...new Set(origens.map((o) => o.job_origem_id))];

  const [pessoaRes, origensRes, espelhos, jobRes] = await Promise.all([
    p.enviado_por
      ? supabase
          .from("profiles")
          .select("nome")
          .eq("id", p.enviado_por)
          .maybeSingle<{ nome: string | null }>()
      : Promise.resolve({ data: null, error: null }),
    idsOrigem.length
      ? supabase.from("jobs").select("id, codigo").in("id", idsOrigem)
      : Promise.resolve({ data: [] as any[], error: null }),
    espelhosDaAprovacao(supabase, tenantId, jobId, p.id, p.momento),
    supabase
      .from("jobs")
      .select("valor_total, faturamento_previsto, faturamento_save_previsto")
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{
        valor_total: number | string | null;
        faturamento_previsto: number | string | null;
        faturamento_save_previsto: number | string | null;
      }>(),
  ]);
  if (!espelhos.ok) {
    // Sem a conta dos números a revisão validaria contra o número errado:
    // melhor não abrir a aprovação.
    console.error("[abertura-job.aprovacao-save.espelhos]", espelhos.message);
    return { ok: false };
  }
  const codigo = new Map<string, string>(
    ((origensRes.data ?? []) as any[]).map((j) => [j.id, j.codigo ?? "—"]),
  );
  const numOuNulo = (v: unknown) =>
    v === null || v === undefined ? null : Number(v);

  return {
    ok: true,
    aprovacao: {
      pedidoId: p.id,
      linhaId: p.job_item_orcado_id ?? null,
      tipo: p.tipo as SaveAprovacaoTipo,
      momento: p.momento as SaveAprovacaoMomento,
      itemDescricao: p.item_descricao,
      grupoNome: p.grupo_nome ?? null,
      valor: Number(p.valor ?? 0),
      origens: origens
        .map((o) => ({
          jobId: o.job_origem_id,
          codigo: codigo.get(o.job_origem_id) ?? "—",
          valor: Number(o.valor ?? 0),
        }))
        .sort((a, b) => b.valor - a.valor),
      enviadoPorNome: pessoaRes.data?.nome ?? null,
      enviadoEmLabel: formatDataHoraBr(p.enviado_em),
      errataId: p.errata_id ?? null,
      valorJobAntes: numOuNulo(p.valor_job_antes),
      valorJobDepois: numOuNulo(p.valor_job_depois),
      faturamentoPrevistoAntes: numOuNulo(p.faturamento_previsto_antes),
      faturamentoPrevistoDepois: numOuNulo(p.faturamento_previsto_depois),
      depois: espelhos.totais ?? {
        valor_total: Number(jobRes.data?.valor_total ?? 0),
        faturamento_previsto: Number(jobRes.data?.faturamento_previsto ?? 0),
        faturamento_save_previsto: Number(jobRes.data?.faturamento_save_previsto ?? 0),
      },
    },
  };
}
