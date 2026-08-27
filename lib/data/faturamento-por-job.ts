import { createClient } from "@/lib/supabase/server";
import {
  classificarFaturamento,
  type SituacaoFaturamento,
} from "@/lib/calculos/esteira-faturamento";

/**
 * Onde cada job está na esteira do faturamento, para um lote de jobs.
 *
 * Três leituras rasas e o cruzamento em memória: os envios, as notas e os
 * títulos delas. Embed de `faturamentos` dentro de `jobs` não existe (a
 * ligação é polimórfica, por `origem_tipo`/`origem_id`) e embed pesado é
 * o anti-padrão que `docs/PERFORMANCE.md` proíbe.
 *
 * Módulo próprio desde 20/08/2026, quando a visão agregada do projeto no
 * financeiro passou a precisar da mesma classificação que a lista de jobs
 * abertos. Duas cópias dessa conta divergiriam na primeira nota
 * cancelada.
 */
export interface FaturamentoDoJob {
  situacao: SituacaoFaturamento;
  /**
   * O número da coluna Faturamento: valor da nota quando ela existe,
   * valor enviado quando só houve envio, e nulo quando nenhum dos dois
   * aconteceu (aí quem decide o fallback é quem chamou).
   */
  valor: number | null;
  numero_nf: string | null;
  data_envio: string | null;
  /** Quanto já foi recebido — soma dos títulos pagos da nota. */
  valor_recebido: number;
  /** Vencimento em aberto mais antigo. É o que data a inadimplência. */
  vencimento_em_aberto: string | null;
}

export async function faturamentoPorJob(
  tenantId: string,
  hoje: string = new Date().toISOString().slice(0, 10),
): Promise<Map<string, FaturamentoDoJob>> {
  const supabase = createClient();

  const [enviosRes, notasRes, titulosRes, saveOnlyRes] = await Promise.all([
    supabase
      .from("jobs_envio_faturamento")
      .select("job_id, valor_faturado, enviado_em")
      .eq("tenant_id", tenantId),
    // Nota cancelada não conta como faturada — o job volta a esperar.
    supabase
      .from("faturamentos")
      .select("id, origem_id, numero_nf, valor_total")
      .eq("tenant_id", tenantId)
      .eq("origem_tipo", "job")
      .eq("status", "emitido"),
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
  ]);

  if (enviosRes.error) {
    console.error("[faturamento-por-job.envios]", enviosRes.error.message);
  }
  if (notasRes.error) {
    console.error("[faturamento-por-job.notas]", notasRes.error.message);
  }
  if (titulosRes.error) {
    console.error("[faturamento-por-job.titulos]", titulosRes.error.message);
  }

  const envioPorJob = new Map<string, { valor: number; em: string }>();
  for (const e of (enviosRes.data ?? []) as any[]) {
    envioPorJob.set(e.job_id, {
      valor: Number(e.valor_faturado ?? 0),
      em: e.enviado_em,
    });
  }

  const notaPorJob = new Map<
    string,
    { id: string; numero: string | null; valor: number }
  >();
  for (const n of (notasRes.data ?? []) as any[]) {
    notaPorJob.set(n.origem_id, {
      id: n.id,
      numero: n.numero_nf ?? null,
      valor: Number(n.valor_total ?? 0),
    });
  }

  const titulosPorNota = new Map<
    string,
    { valor: number; vencimento: string; status: string }[]
  >();
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
    ...notaPorJob.keys(),
    ...saveOnly,
  ]);

  const mapa = new Map<string, FaturamentoDoJob>();
  for (const jobId of jobIds) {
    const nota = notaPorJob.get(jobId);
    const envio = envioPorJob.get(jobId);
    const titulos = nota ? (titulosPorNota.get(nota.id) ?? []) : [];

    const emAberto = titulos.filter((t) => t.status !== "pago");
    const valorRecebido = titulos
      .filter((t) => t.status === "pago")
      .reduce((s, t) => s + t.valor, 0);

    mapa.set(jobId, {
      situacao: classificarFaturamento(
        !!nota,
        !!envio,
        titulos,
        hoje,
        saveOnly.has(jobId) && !envio,
      ),
      valor: nota?.valor ?? envio?.valor ?? null,
      numero_nf: nota?.numero ?? null,
      data_envio: envio?.em ?? null,
      valor_recebido: valorRecebido,
      vencimento_em_aberto: emAberto.map((t) => t.vencimento).sort()[0] ?? null,
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
