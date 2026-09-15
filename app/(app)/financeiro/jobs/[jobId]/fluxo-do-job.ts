import { createClient } from "@/lib/supabase/server";
import {
  montarMatrizFluxo,
  type LinhaFluxo,
  type MatrizFluxo,
} from "@/lib/calculos/fluxo-caixa-matriz";
import type { PrazosDoJob } from "@/components/financeiro/fluxo-caixa-jobs";
import { calcularPrazosDoJob } from "@/lib/calculos/prazos-do-job";
import { notasEmitidasDosJobs } from "@/lib/data/faturamento-por-job";

/**
 * As linhas de fluxo de caixa de um conjunto de jobs.
 *
 * Tudo sai de `vw_fluxo_caixa` filtrada por `job_id`. A view já resolve
 * as três classes que a tela desenha como sub-linhas de cada natureza
 * (movimento, título, previsão) e já resolve o abatimento: previsão
 * coberta por PP ou por nota some da classe `previsao` e reaparece em
 * `titulo` ou `movimento`, consumida da data mais próxima para a mais
 * distante. Refazer essa conta aqui era o caminho garantido para a tela
 * divergir do Fluxo de Caixa geral.
 *
 * Devolve as linhas CRUAS, e não a matriz pronta: a visão agregada do
 * projeto remonta a matriz no cliente a cada filtro de job ou de conta
 * bancária, sem ida ao servidor.
 */
export async function carregarLinhasDeFluxo(
  tenantId: string,
  jobIds: string[],
): Promise<LinhaFluxo[]> {
  if (jobIds.length === 0) return [];

  const supabase = createClient();

  const { data, error } = await supabase
    .from("vw_fluxo_caixa")
    .select(
      "job_id, conta_bancaria_id, classe, origem_tipo, origem_lancamento, " +
        "data_evento, valor, natureza, descricao",
    )
    .eq("tenant_id", tenantId)
    .in("job_id", jobIds)
    .order("data_evento", { ascending: true });

  if (error) {
    console.error("[fluxo-do-job]", error.message);
    return [];
  }

  return ((data ?? []) as any[])
    .filter((l) => !soDepoisDaBaixa(l.classe, l.origem_tipo))
    .map((l) => {
      const { codigo, descricao } = repartirDescricao(
        l.descricao,
        l.origem_tipo,
      );
      return {
        jobId: l.job_id as string,
        contaBancariaId: (l.conta_bancaria_id as string | null) ?? null,
        classe: l.classe,
        natureza: l.natureza,
        dataEvento: l.data_evento as string,
        valor: Number(l.valor ?? 0),
        codigo,
        descricao,
        origemTipo: l.origem_tipo as string,
        origemLancamento: (l.origem_lancamento as string | null) ?? null,
      };
    });
}

/**
 * O que não é PP só entra no fluxo do JOB depois da baixa.
 *
 * Decisão do Tiago, 26/08/2026. Conta avulsa e desembolso aprovados são
 * compromisso real da empresa e continuam no Fluxo de Caixa geral — mas
 * no recorte por job eles só aparecem como movimento, depois de pagos.
 *
 * O motivo é o abatimento: a curva de desembolso da abertura só é
 * abatida por PP (decisão 004). Uma avulsa aprovada somaria como título
 * a pagar do job sem tirar nada da previsão, e o job apareceria devendo
 * o mesmo dinheiro duas vezes.
 *
 * O filtro vive aqui, e não na view, justamente porque a view é lida
 * também pela tesouraria, onde esses títulos TÊM de aparecer. A
 * `vw_fluxo_caixa_job_totais` aplica o mesmo recorte do lado do banco,
 * para a lista de jobs não divergir desta aba.
 */
function soDepoisDaBaixa(classe: string, origemTipo: string): boolean {
  return (
    classe === "titulo" &&
    (origemTipo === "avulsa" ||
      origemTipo === "recorrente" ||
      origemTipo === "desembolso")
  );
}

/** A matriz de UM job, montada no servidor — a aba do job não filtra. */
export async function carregarFluxoDoJob(
  tenantId: string,
  jobId: string,
  hoje: string = new Date().toISOString().slice(0, 10),
): Promise<MatrizFluxo> {
  const linhas = await carregarLinhasDeFluxo(tenantId, [jobId]);
  return montarMatrizFluxo(linhas, hoje);
}

/**
 * Separa código e descrição.
 *
 * `vw_fluxo_caixa.descricao` já vem montada e carrega o código dentro
 * dela — "PP PP-00009 3/3 — Locação de som e luz", "Título NF 900123/2",
 * "Desembolso DES-00001 1/3 — ...". A tela mostra os dois em colunas
 * separadas, então o que a view juntou é desfeito aqui, e não numa coluna
 * nova do banco: a view é lida por várias telas e mexer nela para uma
 * seria caro à toa.
 */
function repartirDescricao(
  bruta: string | null,
  origemTipo: string,
): { codigo: string; descricao: string } {
  const bruto = (bruta ?? "").trim();
  const semPrefixo = bruto.replace(
    // "Estorno da baixa de" e "Recebimento" entraram em 26/08/2026, com a
    // composição no hover: sem eles o código do estorno virava a frase
    // inteira ("Estorno da baixa de PP-00009 3/3"), que não cabe na
    // coluna e repete o que o rótulo já diz.
    /^(Estorno da baixa de|Recebimento|PP|Título|Avulsa|Desembolso)\s+/i,
    "",
  );

  if (semPrefixo.includes(" — ")) {
    const [codigo, ...resto] = semPrefixo.split(" — ");
    return {
      codigo: codigo.trim() || rotuloDaOrigem(origemTipo),
      descricao: resto.join(" — ").trim() || rotuloDaOrigem(origemTipo),
    };
  }

  // As linhas de previsão não têm travessão — vêm como "Curva JOB-0013 ·
  // desembolso 1/2". O ponto médio separa o que é rótulo do que é
  // identificação da parcela, na ordem inversa.
  if (semPrefixo.includes(" · ")) {
    const corte = semPrefixo.indexOf(" · ");
    return {
      codigo: semPrefixo.slice(corte + 3).trim(),
      descricao: semPrefixo.slice(0, corte).trim(),
    };
  }

  return {
    codigo: semPrefixo.trim() || rotuloDaOrigem(origemTipo),
    descricao: rotuloDaOrigem(origemTipo),
  };
}

function rotuloDaOrigem(origem: string): string {
  if (origem === "pp") return "Pedido de produção";
  if (origem === "titulo") return "Título a receber";
  if (origem === "avulsa") return "Conta avulsa";
  if (origem === "recorrente") return "Conta recorrente";
  // `desembolso` entrou na view em 20/08/2026, pela frente do Antonio
  // (migration 20260820000010).
  if (origem === "desembolso") return "Desembolso";
  if (origem === "lancamento") return "Movimento na conta";
  if (origem === "previsao_custo") return "Cronograma de desembolsos";
  if (origem === "previsao_recebimento") return "Previsão de recebimento";
  if (origem === "envio_parcela") return "Faturamento previsto";
  return origem;
}

/**
 * Os três prazos de cada job, em dias corridos. Sem a ponta que fecha o
 * prazo, o campo é nulo e a tela mostra travessão.
 *
 * A regra mora em `lib/calculos/prazos-do-job.ts` (decisão 075, nota de
 * 15/09/2026): emissão e vencimento médios, ponderados pela parte do job
 * nas notas emitidas; sem nota, o previsto da abertura. Até 15/09 valiam a
 * primeira emissão e o último vencimento, e o job mensal somava a previsão
 * dos meses ainda sem nota.
 *
 * As notas vêm de `notasEmitidasDosJobs` — a mesma leitura pelos itens da
 * esteira, com os títulos de cada nota.
 */
export async function carregarPrazosDosJobs(
  tenantId: string,
  jobIds: string[],
): Promise<PrazosDoJob[]> {
  if (jobIds.length === 0) return [];

  const supabase = createClient();

  const [jobsRes, notasPorJob, previsoesRes] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, data_abertura_financeiro, data_prevista_faturamento")
      .eq("tenant_id", tenantId)
      .in("id", jobIds),
    notasEmitidasDosJobs(tenantId, jobIds),
    supabase
      .from("jobs_previsao_recebimento")
      .select("job_id, data_prevista")
      .eq("tenant_id", tenantId)
      .in("job_id", jobIds),
  ]);

  if (jobsRes.error) console.error("[prazos.jobs]", jobsRes.error.message);
  if (previsoesRes.error) {
    console.error("[prazos.previsoes]", previsoesRes.error.message);
  }

  const previsaoPorJob = new Map<string, string[]>();
  for (const p of (previsoesRes.data ?? []) as any[]) {
    const arr = previsaoPorJob.get(p.job_id) ?? [];
    arr.push(p.data_prevista);
    previsaoPorJob.set(p.job_id, arr);
  }

  return ((jobsRes.data ?? []) as any[]).map((j) => ({
    jobId: j.id as string,
    ...calcularPrazosDoJob({
      abertura: j.data_abertura_financeiro ?? null,
      faturamentoPrevisto: j.data_prevista_faturamento ?? null,
      notas: notasPorJob.get(j.id) ?? [],
      previsoesRecebimento: previsaoPorJob.get(j.id) ?? [],
    }),
  }));
}
