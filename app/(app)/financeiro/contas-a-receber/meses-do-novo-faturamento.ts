/**
 * Decisão 256: os meses do job mensal (Fee, Always On) e da Mídia Off para o
 * Novo faturamento. Por mês: o previsto, o que o envio do GP ainda espera de
 * nota e o que já saiu em nota (pelo envio ou pelo financeiro).
 *
 * Lido só quando preciso — no Faturar, ao escolher um job mensal (action
 * `carregarMesesDoNovoFaturamento`), e na página só para os jobs que já têm
 * Novo faturamento por mês (a linha do saldo) — para a página não ler os
 * meses de todos os jobs mensais (docs/PERFORMANCE.md).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerFaturamentoMensalPeloJob } from "@/lib/data/faturamento-mensal";

export interface MesDoNovoFaturamento {
  /** O mês, dia 1 ("2026-10-01"). */
  mes: string;
  /** O previsto do mês. */
  faturamento: number;
  /** O que o envio do GP do mês ainda espera de nota. */
  a_faturar_no_envio: number;
  /** O que já saiu em nota no mês (pelo envio ou pelo financeiro). */
  ja_faturado: number;
  /** O GP mandou o mês para faturamento. */
  tem_envio: boolean;
  /** O financeiro faturou o mês pelo Novo faturamento. */
  pelo_financeiro: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Nulo: o job não fatura por mês, ou a leitura falhou. */
export async function lerMesesDoNovoFaturamento(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<MesDoNovoFaturamento[] | null> {
  const [mensal, enviosRes, pendentesRes, novosRes] = await Promise.all([
    lerFaturamentoMensalPeloJob(supabase, tenantId, jobId, []),
    supabase
      .from("jobs_envio_faturamento")
      .select("mes, valor_faturado")
      .eq("tenant_id", tenantId)
      .eq("job_id", jobId)
      .not("mes", "is", null),
    supabase
      .from("vw_faturamento_pendente")
      .select("mes_referencia, saldo")
      .eq("tenant_id", tenantId)
      .eq("origem_tipo", "job")
      .eq("job_id", jobId),
    // As notas do Novo faturamento do job, uma vez cada (o embed `!inner`
    // filtra pelo item do job; a nota que tem job e save vem uma vez só).
    supabase
      .from("faturamentos")
      .select("id, valor_total, mes_novo_faturamento, itens:faturamento_itens!inner(origem_id)")
      .eq("tenant_id", tenantId)
      .eq("status", "emitido")
      .eq("faturado_pelo_financeiro", true)
      .not("mes_novo_faturamento", "is", null)
      .eq("itens.origem_id", jobId),
  ]);
  if (!mensal?.mensal || !mensal.meses) return null;
  for (const [nome, res] of [
    ["envios", enviosRes],
    ["pendentes", pendentesRes],
    ["novos", novosRes],
  ] as const) {
    if (res.error) {
      console.error(`[meses-do-novo-faturamento.${nome}]`, res.error.message);
      return null;
    }
  }

  const soma = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const envio = new Map<string, number>();
  for (const e of (enviosRes.data ?? []) as Array<{ mes: string; valor_faturado: number | string }>)
    soma(envio, e.mes, Number(e.valor_faturado ?? 0));
  const pendente = new Map<string, number>();
  for (const p of (pendentesRes.data ?? []) as Array<{ mes_referencia: string | null; saldo: number | string }>)
    if (p.mes_referencia) soma(pendente, p.mes_referencia, Number(p.saldo ?? 0));
  const novo = new Map<string, number>();
  for (const f of (novosRes.data ?? []) as Array<{ valor_total: number | string; mes_novo_faturamento: string }>)
    soma(novo, f.mes_novo_faturamento, Number(f.valor_total ?? 0));

  return mensal.meses.map((m) => {
    const enviado = envio.get(m.mes) ?? 0;
    const aFaturar = r2(pendente.get(m.mes) ?? 0);
    const pelo = r2(novo.get(m.mes) ?? 0);
    return {
      mes: m.mes,
      faturamento: r2(m.faturamento),
      a_faturar_no_envio: aFaturar,
      ja_faturado: r2(Math.max(0, enviado - aFaturar) + pelo),
      tem_envio: enviado > 0.004,
      pelo_financeiro: pelo,
    };
  });
}
