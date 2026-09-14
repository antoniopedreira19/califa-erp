import { createClient } from "@/lib/supabase/server";
import {
  consolidarNotasDoJob,
  type NotaDoJob,
  type SituacaoFaturamento,
  type TituloDaNota,
} from "@/lib/calculos/esteira-faturamento";

/**
 * Onde cada job está na esteira do faturamento, para um lote de jobs.
 *
 * Leituras rasas em paralelo e o cruzamento em memória: os envios, os
 * itens das notas emitidas e os títulos delas. Embed de `faturamentos`
 * dentro de `jobs` não existe (a ligação é polimórfica) e embed pesado é o
 * anti-padrão que `docs/PERFORMANCE.md` proíbe — o único embed aqui é o
 * cabeçalho da nota em cada item, uma linha por item.
 *
 * Módulo próprio desde 20/08/2026, quando a visão agregada do projeto no
 * financeiro passou a precisar da mesma classificação que a lista de jobs
 * abertos. Duas cópias dessa conta divergiriam na primeira nota
 * cancelada.
 *
 * ⚠️ Desde 14/09/2026 (decisão 075) a nota de um job se reconhece pelos
 * ITENS (`faturamento_itens.origem_id`), não mais por
 * `faturamentos.origem_id`. O cabeçalho fica com `origem_id` nulo sempre
 * que a nota tem mais de um item (decisão 017 §2) — NF agrupada, nota de
 * um job com saldo em save, nota com duas parcelas do mesmo job —, e a
 * leitura antiga deixava esses jobs em "enviado" com a nota já emitida.
 */
export interface FaturamentoDoJob {
  situacao: SituacaoFaturamento;
  /**
   * O número da coluna Faturamento: a PARTE do job nas notas emitidas
   * (nunca o total de uma NF agrupada), valor enviado quando só houve
   * envio, e nulo quando nenhum dos dois aconteceu (aí quem decide o
   * fallback é quem chamou).
   */
  valor: number | null;
  /** Todas as notas do job, em ordem de emissão: "101 · 102". */
  numero_nf: string | null;
  data_envio: string | null;
  /** Quanto já foi recebido — rateado pela parte do job em cada nota. */
  valor_recebido: number;
  /** Vencimento em aberto mais antigo. É o que data a inadimplência. */
  vencimento_em_aberto: string | null;
}

export async function faturamentoPorJob(
  tenantId: string,
  hoje: string = new Date().toISOString().slice(0, 10),
): Promise<Map<string, FaturamentoDoJob>> {
  const supabase = createClient();

  const [enviosRes, itensRes, titulosRes, saveOnlyRes, mesesPrevistosRes] = await Promise.all([
    supabase
      .from("jobs_envio_faturamento")
      .select("job_id, mes, valor_faturado, enviado_em")
      .eq("tenant_id", tenantId),
    // Os itens de job e de save das notas emitidas. Nos dois tipos o
    // `origem_id` do item é o job (o CHECK `chk_fat_item_origem` o exige
    // preenchido) — é a mesma chave que a aba Faturamento usa para listar
    // os jobs cobertos por uma nota. Nota cancelada não conta como
    // faturada: o job volta a esperar.
    supabase
      .from("faturamento_itens")
      .select(
        "faturamento_id, origem_id, valor, faturamento:faturamentos!inner(numero_nf, data_emissao, valor_total, status)",
      )
      .eq("tenant_id", tenantId)
      .in("origem_tipo", ["job", "save"])
      .eq("faturamento.status", "emitido"),
    // Título cancelado fica de fora: não é dinheiro a receber nem
    // recebido, então não pesa em liquidado nem em inadimplente.
    supabase
      .from("titulos_receber")
      .select("faturamento_id, valor, data_vencimento, status")
      .eq("tenant_id", tenantId)
      .neq("status", "cancelado"),
    // Linhas de job que consomem saldo de save. Cruzadas abaixo com o
    // faturamento previsto zero, dão o job que pula a etapa.
    supabase
      .from("jobs_itens_orcado")
      .select("job_id, jobs!inner(faturamento_previsto)")
      .eq("tenant_id", tenantId)
      .gt("save_consumido", 0)
      .lte("jobs.faturamento_previsto", 0.004),
    // Os meses que o job mensal fatura (decisão 078): uma linha por mês com
    // faturamento na previsão de recebimento. É contra eles que se sabe se
    // falta mês a enviar.
    supabase
      .from("jobs_previsao_recebimento")
      .select("job_id, mes")
      .eq("tenant_id", tenantId)
      .not("mes", "is", null),
  ]);

  if (enviosRes.error) {
    console.error("[faturamento-por-job.envios]", enviosRes.error.message);
  }
  if (itensRes.error) {
    console.error("[faturamento-por-job.itens]", itensRes.error.message);
  }
  if (titulosRes.error) {
    console.error("[faturamento-por-job.titulos]", titulosRes.error.message);
  }

  // Um envio por job — ou um por mês nos jobs do modelo mensal (decisão
  // 078). Com vários, o valor enviado é a soma e a data é a do primeiro.
  const envioPorJob = new Map<
    string,
    { valor: number; em: string; mensais: number }
  >();
  for (const e of (enviosRes.data ?? []) as any[]) {
    const atual = envioPorJob.get(e.job_id);
    envioPorJob.set(e.job_id, {
      valor: (atual?.valor ?? 0) + Number(e.valor_faturado ?? 0),
      em: atual && atual.em < e.enviado_em ? atual.em : e.enviado_em,
      mensais: (atual?.mensais ?? 0) + (e.mes ? 1 : 0),
    });
  }
  if (mesesPrevistosRes.error) {
    console.error("[faturamento-por-job.meses]", mesesPrevistosRes.error.message);
  }
  const mesesPorJob = new Map<string, Set<string>>();
  for (const p of (mesesPrevistosRes.data ?? []) as any[]) {
    const meses = mesesPorJob.get(p.job_id) ?? new Set<string>();
    meses.add(p.mes);
    mesesPorJob.set(p.job_id, meses);
  }

  // Cabeçalho de cada nota e, por job, quanto de cada nota é dele. Um job
  // pode estar em várias notas (uma por parcela do envio), e uma nota pode
  // cobrir vários jobs (NF agrupada) — os dois mapas cobrem os dois lados.
  const cabecalhoPorNota = new Map<
    string,
    { numero: string | null; data_emissao: string | null; valor_total: number }
  >();
  const partesPorJob = new Map<string, Map<string, number>>();
  for (const it of (itensRes.data ?? []) as any[]) {
    if (!it.origem_id || !it.faturamento) continue;
    cabecalhoPorNota.set(it.faturamento_id, {
      numero: it.faturamento.numero_nf ?? null,
      data_emissao: it.faturamento.data_emissao ?? null,
      valor_total: Number(it.faturamento.valor_total ?? 0),
    });
    const partes = partesPorJob.get(it.origem_id) ?? new Map<string, number>();
    partes.set(
      it.faturamento_id,
      (partes.get(it.faturamento_id) ?? 0) + Number(it.valor ?? 0),
    );
    partesPorJob.set(it.origem_id, partes);
  }

  const titulosPorNota = new Map<string, TituloDaNota[]>();
  for (const t of (titulosRes.data ?? []) as any[]) {
    const arr = titulosPorNota.get(t.faturamento_id) ?? [];
    arr.push({
      valor: Number(t.valor ?? 0),
      vencimento: t.data_vencimento,
      status: t.status,
    });
    titulosPorNota.set(t.faturamento_id, arr);
  }

  // Job pago SÓ por saldo de save: faturamento previsto zero e consumo
  // registrado. Ele pula a etapa de faturamento e entra na esteira como
  // já faturado — a nota dele saiu no job que gerou o crédito (decisão
  // 028 §11). Sem isto ficaria eternamente em "aguardando envio".
  const saveOnly = new Set<string>(
    ((saveOnlyRes.data ?? []) as any[])
      .map((o) => o.job_id as string)
      .filter(Boolean),
  );

  // Todo job que apareceu em qualquer uma das leituras entra no mapa. Job
  // que não aparece em nenhuma não tem entrada — quem chamou trata como
  // `aguardando_envio`.
  const jobIds = new Set<string>([
    ...envioPorJob.keys(),
    ...partesPorJob.keys(),
    ...saveOnly,
  ]);

  const mapa = new Map<string, FaturamentoDoJob>();
  for (const jobId of jobIds) {
    const envio = envioPorJob.get(jobId);

    const notas: NotaDoJob[] = [];
    for (const [notaId, parte] of partesPorJob.get(jobId) ?? []) {
      const cabecalho = cabecalhoPorNota.get(notaId);
      if (!cabecalho) continue;
      notas.push({
        id: notaId,
        ...cabecalho,
        parte_do_job: parte,
        titulos: titulosPorNota.get(notaId) ?? [],
      });
    }

    // Job mensal: só liquida com todos os meses enviados e as notas
    // cobrindo tudo o que foi enviado.
    const mensais = envio?.mensais ?? 0;
    const parteNasNotas = notas.reduce((s, n) => s + n.parte_do_job, 0);
    const faltaFaturar =
      mensais > 0 &&
      (mensais < (mesesPorJob.get(jobId)?.size ?? 0) ||
        parteNasNotas < (envio?.valor ?? 0) - 0.01);

    const consolidado = consolidarNotasDoJob(
      notas,
      !!envio,
      hoje,
      saveOnly.has(jobId) && !envio,
      faltaFaturar,
    );

    mapa.set(jobId, {
      situacao: consolidado.situacao,
      valor: consolidado.valor_faturado ?? envio?.valor ?? null,
      numero_nf: consolidado.numeros_nf,
      data_envio: envio?.em ?? null,
      valor_recebido: consolidado.valor_recebido,
      vencimento_em_aberto: consolidado.vencimento_em_aberto,
    });
  }

  return mapa;
}

/** O estado de quem ainda não entrou na esteira. */
export const FATURAMENTO_VAZIO: FaturamentoDoJob = {
  situacao: "aguardando_envio",
  valor: null,
  numero_nf: null,
  data_envio: null,
  valor_recebido: 0,
  vencimento_em_aberto: null,
};
