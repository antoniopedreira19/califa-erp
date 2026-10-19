/**
 * A conferência do envio de UM job para faturamento — a mesma régua para o
 * envio pela página do job (`enviarJobParaFaturamento`) e para o envio em
 * lote pela lista de Jobs (decisão 188). Separada em 19/10/2026, quando o
 * lote nasceu, para as duas portas não divergirem.
 *
 * Confere, nesta ordem: o job existe; o mês (só o mensal e a Mídia Off vão
 * por mês); o status; os consumos de save aguardando ou nunca enviados
 * (decisão 099); a revisão da abertura; a errata pronta parada (159); o
 * VALOR, relido do banco — o faturamento previsto no envio único, o
 * faturamento DO MÊS no modelo mensal —; e se o job (ou o mês) já foi
 * enviado. O valor nunca vem do navegador.
 *
 * As travas próprias da Mídia Off (veiculação do mês e encerramento junto
 * do último mês, decisão 167) ficam na action do job, que é a única porta
 * da Mídia Off — o lote não aceita Mídia Off.
 *
 * Não grava nada. Quando a recusa merece auditoria (`acao_negada`), devolve
 * o motivo e os detalhes; quem chama registra, com a ação tentada dele.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { jobAceitaEnvioParaFaturamento, jobStatusLabel, type JobStatus } from "@/lib/types";
import { lerFaturamentoPorMesDoJob } from "@/lib/data/faturamento-mensal";
import { nomeDoMes } from "@/lib/calculos/meses-trimestre";
import { parametrosDaVersao, type ParametrosMidia } from "@/lib/calculos/midia-off";
import type { FaturamentoDoMes } from "@/lib/calculos/faturamento-por-mes";

/** "outubro" → "Outubro", para abrir frase. */
export function comMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** O envio para faturamento travado por consumo de save nunca enviado
 *  para aprovação (decisão 099, 22/09/2026). Sem link para o financeiro:
 *  quem resolve é a produção, pelo botão da planilha — e a linha com
 *  recusa ainda não retirada o botão não envia. A barra do job
 *  (`barra-acoes-job.tsx`) monta o mesmo texto. */
export function mensagemConsumosNaoEnviados(
  consumos: { item: string; comRecusa: boolean }[],
): string {
  const n = consumos.length;
  const itens = consumos.map((c) => c.item).join(", ");
  const comRecusa = consumos.filter((c) => c.comRecusa).map((c) => `“${c.item}”`);
  const partes = [
    n === 1
      ? `1 consumo de save ainda não foi enviado para aprovação do financeiro (${itens}).`
      : `${n} consumos de save ainda não foram enviados para aprovação do financeiro (${itens}).`,
  ];
  if (comRecusa.length < n) {
    partes.push("Envie pelo botão “Enviar saves para aprovação”, acima da planilha.");
  }
  if (comRecusa.length > 0) {
    partes.push(
      `Em ${comRecusa.join(", ")}, retire antes a recusa no pop-up de save da linha: o botão “Enviar saves para aprovação” não envia linha com recusa.`,
    );
  }
  partes.push(
    "O envio para faturamento volta quando o financeiro decidir: o consumo muda o faturamento previsto.",
  );
  return partes.join(" ");
}

export interface JobDaConferencia {
  id: string;
  codigo: string;
  status: JobStatus;
  faturamento_previsto: number | string | null;
  abertura_em_revisao: boolean | null;
  empresa_id: string | null;
  projeto_id: string;
  orcamento_id: string;
  projeto: { cliente_id: string } | null;
  versao_orcamento_aprovada_id: string;
  orcamento: { categoria: { modelo_planilha: string } | null } | null;
  versao: {
    percentual_honorarios: number | string;
    percentual_imposto: number | string;
    percentual_veiculo: number | string | null;
    base_honorarios: string | null;
  } | null;
}

export type ConferenciaDoEnvio =
  | {
      ok: true;
      job: JobDaConferencia;
      mensal: boolean;
      midiaOff: boolean;
      paramsMidia: ParametrosMidia | null;
      mes: string | null;
      nomeMes: string | null;
      /** O valor a faturar, relido do banco. */
      valor: number;
      valorSave: number | null;
      /** Os meses do job (só no mensal), para as travas da Mídia Off. */
      porMes: FaturamentoDoMes[] | null;
    }
  | {
      ok: false;
      message: string;
      /** Recusa que vira `acao_negada` na auditoria. */
      auditoria?: { motivo: string; detalhes?: Record<string, unknown> };
    };

export async function conferirEnvioDoJob(
  supabase: SupabaseClient,
  p: { tenantId: string; jobId: string; mes: string | null },
): Promise<ConferenciaDoEnvio> {
  const { tenantId, jobId } = p;

  // O job, os pedidos de save e as linhas que consomem save (decisão 099):
  // leituras independentes, em paralelo.
  const [{ data: job }, pedidosSaveRes, linhasConsumoRes] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, codigo, status, faturamento_previsto, abertura_em_revisao, empresa_id, projeto_id, orcamento_id, versao_orcamento_aprovada_id, projeto:projetos(cliente_id), orcamento:orcamentos(categoria:categorias_dominio!categoria_id(modelo_planilha)), versao:versoes_orcamento!versao_orcamento_aprovada_id(percentual_honorarios, percentual_imposto, percentual_veiculo, base_honorarios)",
      )
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle<JobDaConferencia>(),
    // Os pedidos que ainda contam: aguardando e aprovado dizem que a linha
    // foi enviada; o recusado não arquivado segura o botão "Enviar saves
    // para aprovação", que não envia linha com recusa.
    supabase
      .from("saves_aprovacoes")
      .select("job_item_orcado_id, item_descricao, tipo, situacao")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .in("situacao", ["aguardando", "aprovado", "recusado"]),
    supabase
      .from("jobs_itens_orcado")
      .select("id, item")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .gt("save_consumido", 0),
  ]);

  if (!job) return { ok: false, message: "Job não encontrado." };

  // Modelo mensal (decisão 078): Fee e Always On são enviados para
  // faturamento MÊS A MÊS — cada envio leva o mês. Os outros jobs seguem
  // com o envio único, sem mês. O envio único num job mensal congelaria o
  // trimestre inteiro.
  //
  // A Mídia Off também fatura mês a mês (decisão 167), pela conta da mídia,
  // e cada mês só depois da última veiculação dele.
  const midiaOff = job.orcamento?.categoria?.modelo_planilha === "midia_off";
  const mensal = job.orcamento?.categoria?.modelo_planilha === "mensal" || midiaOff;
  const paramsMidia =
    midiaOff && job.versao
      ? parametrosDaVersao({
          percentual_honorarios: job.versao.percentual_honorarios,
          percentual_imposto: job.versao.percentual_imposto,
          base_honorarios: job.versao.base_honorarios,
          percentual_veiculo: job.versao.percentual_veiculo,
        })
      : null;
  const mes = p.mes ?? null;
  if (mensal && !mes) {
    return {
      ok: false,
      message: midiaOff
        ? "Jobs de Mídia Off são enviados para faturamento mês a mês: escolha o mês a enviar."
        : "Jobs de Fee e Always On são enviados para faturamento mês a mês: escolha o mês a enviar.",
    };
  }
  if (!mensal && mes) {
    return {
      ok: false,
      message: "Só jobs de Fee, Always On e Mídia Off são enviados para faturamento por mês.",
    };
  }
  const nomeMes = mes ? nomeDoMes(mes) : null;

  // Desde 16/09/2026 (decisão 087) o job encerrado ainda não faturado
  // continua enviando: faturamento e encerramento correm separados.
  if (!jobAceitaEnvioParaFaturamento(job.status)) {
    return {
      ok: false,
      message:
        "Só job aberto ou encerrado pode ser enviado para faturamento. Este está " +
        `${jobStatusLabel(job.status).toLowerCase()}.`,
    };
  }

  // Consumo de save que aguarda o financeiro (decisão 099, 22/09/2026): o
  // consumo muda o faturamento previsto, e a nota sairia por um número que
  // o financeiro ainda não aprovou — ou que volta se ele recusar. Vale para
  // o job inteiro também no modelo mensal: é o lado conservador, e a
  // decisão do financeiro destrava o envio. Leitura que falhou trava.
  const leituraDoSaveFalhou = Boolean(pedidosSaveRes.error || linhasConsumoRes.error);
  if (pedidosSaveRes.error) {
    console.error("[job.enviarFaturamento.pedidos_save]", pedidosSaveRes.error.message);
  }
  if (linhasConsumoRes.error) {
    console.error("[job.enviarFaturamento.linhas_consumo]", linhasConsumoRes.error.message);
  }
  const pedidosSave = (pedidosSaveRes.data ?? []) as {
    job_item_orcado_id: string | null;
    item_descricao: string;
    tipo: "gera" | "consome";
    situacao: "aguardando" | "aprovado" | "recusado";
  }[];
  const consumosAguardando = pedidosSave.filter(
    (x) => x.tipo === "consome" && x.situacao === "aguardando",
  );
  if (leituraDoSaveFalhou || consumosAguardando.length > 0) {
    const auditoria = {
      motivo: "consumo_de_save_aguardando",
      detalhes: { consumos_aguardando: consumosAguardando.length },
    };
    if (leituraDoSaveFalhou) {
      return {
        ok: false,
        message: "Não foi possível conferir os consumos de save do job. Tente de novo.",
        auditoria,
      };
    }
    const n = consumosAguardando.length;
    const itens = consumosAguardando.map((c) => c.item_descricao).join(", ");
    return {
      ok: false,
      message:
        n === 1
          ? `1 consumo de save aguarda aprovação do financeiro (${itens}). O envio para faturamento volta quando ele for decidido: o consumo muda o faturamento previsto.`
          : `${n} consumos de save aguardam aprovação do financeiro (${itens}). O envio para faturamento volta quando eles forem decididos: o consumo muda o faturamento previsto.`,
      auditoria,
    };
  }

  // Consumo de save NUNCA ENVIADO para aprovação (decisão 099, 22/09/2026):
  // o mesmo recorte do encerramento (`actions-encerramento.ts`) — linha
  // com consumo e sem pedido de consumo aguardando ou aprovado. O pedido
  // recusado não conta como envio: depois de uma edição recusada a linha
  // volta ao consumo de antes, que pode nunca ter sido aprovado. O envio
  // desse consumo ao financeiro mudaria o faturamento previsto depois da
  // nota. No mensal vale para o job inteiro, como o consumo aguardando.
  const consumoComPedido = new Set(
    pedidosSave
      .filter(
        (x) =>
          x.tipo === "consome" && (x.situacao === "aguardando" || x.situacao === "aprovado"),
      )
      .map((x) => x.job_item_orcado_id)
      .filter((id): id is string => Boolean(id)),
  );
  const linhasComRecusa = new Set(
    pedidosSave
      .filter((x) => x.situacao === "recusado")
      .map((x) => x.job_item_orcado_id)
      .filter((id): id is string => Boolean(id)),
  );
  const consumosNaoEnviados = ((linhasConsumoRes.data ?? []) as { id: string; item: string }[])
    .filter((l) => !consumoComPedido.has(l.id))
    .map((l) => ({ item: l.item, comRecusa: linhasComRecusa.has(l.id) }));
  if (consumosNaoEnviados.length > 0) {
    return {
      ok: false,
      message: mensagemConsumosNaoEnviados(consumosNaoEnviados),
      auditoria: {
        motivo: "consumo_de_save_nao_enviado",
        detalhes: {
          consumos_nao_enviados: consumosNaoEnviados.length,
          com_recusa: consumosNaoEnviados.filter((c) => c.comRecusa).length,
        },
      },
    };
  }

  // Errata depois da abertura reabre a conferência do financeiro. Enviar
  // agora emitiria a nota sobre uma previsão de recebimento e uma curva de
  // desembolso montadas com números que a errata já mudou. A barra esconde
  // o botão; a regra mora aqui (27/08/2026). Desde a decisão 099
  // (22/09/2026) o pedido de save feito com o job aberto também põe o job
  // em revisão, e o texto fala dos dois — sem link para o financeiro.
  if (job.abertura_em_revisao === true) {
    return {
      ok: false,
      message:
        "Uma errata ou um pedido de save mexeu no job depois da abertura, e " +
        "o financeiro ainda não reconferiu a abertura. O envio para " +
        "faturamento volta quando a revisão for salva.",
      auditoria: { motivo: "abertura_em_revisao" },
    };
  }

  // Errata pronta para envio parada (decisão 159): o produtor corrigiu o
  // orçado e a correção ainda não foi ao financeiro. Enviar agora faria a
  // nota sair sem ela. Volta quando um GP enviar a errata ou a descartar.
  const { data: prontaParada, error: prontaErr } = await supabase
    .from("jobs_erratas_prontas")
    .select("id")
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .eq("situacao", "pronta")
    .maybeSingle();
  if (prontaErr) {
    console.error("[faturamento.errata_pronta]", prontaErr.message);
    return {
      ok: false,
      message: "Não foi possível conferir a errata pronta do job. Tente de novo.",
    };
  }
  if (prontaParada) {
    return {
      ok: false,
      message:
        "Este job tem uma errata pronta para envio. Envie-a ao financeiro ou descarte-a na Planilha Interna antes de enviar para faturamento.",
      auditoria: {
        motivo: "errata_pronta_parada",
        detalhes: { errata_pronta_id: (prontaParada as { id: string }).id },
      },
    };
  }

  // O valor a faturar é relido aqui, nunca o do navegador: o faturamento
  // previsto do job no envio único, ou o faturamento DO MÊS recalculado dos
  // itens da cópia do job (com as erratas) no modelo mensal.
  let valor: number;
  let valorSave: number | null = null;
  let porMes: FaturamentoDoMes[] | null = null;
  if (mes) {
    porMes = await lerFaturamentoPorMesDoJob(supabase, {
      tenantId,
      jobId,
      versaoAprovadaId: job.versao_orcamento_aprovada_id,
      percentualHonorarios: Number(job.versao?.percentual_honorarios ?? 0),
      percentualImposto: Number(job.versao?.percentual_imposto ?? 0),
      // O envio é do financeiro: save que aguarda aprovação não entra na
      // parte de save do mês (decisão 099).
      contar: [],
      midia: paramsMidia,
    });
    if (!porMes) {
      return {
        ok: false,
        message: "Não foi possível calcular o faturamento do mês. Tente de novo.",
      };
    }
    const doMes = porMes.find((m) => m.mes === mes);
    if (!doMes) {
      return { ok: false, message: "Este mês não faz parte do orçamento aprovado do job." };
    }
    valor = doMes.faturamento;
    valorSave = doMes.save;
  } else {
    valor = Number(job.faturamento_previsto ?? 0);
  }
  if (!(valor > 0)) {
    return {
      ok: false,
      message: nomeMes
        ? `${comMaiuscula(nomeMes)} está sem faturamento — não há valor a faturar.`
        : "Este job está sem faturamento previsto — não há valor a faturar.",
    };
  }

  // Um envio por job — ou por job + mês no modelo mensal (índices únicos
  // parciais). Conferir antes devolve mensagem legível em vez de erro de
  // constraint.
  const consultaEnvio = supabase.from("jobs_envio_faturamento").select("id").eq("job_id", jobId);
  const { data: jaEnviado } = await (mes
    ? consultaEnvio.eq("mes", mes)
    : consultaEnvio.is("mes", null)
  ).maybeSingle<{ id: string }>();
  if (jaEnviado) {
    return { ok: false, message: mensagemJaEnviado(nomeMes) };
  }

  return { ok: true, job, mensal, midiaOff, paramsMidia, mes, nomeMes, valor, valorSave, porMes };
}

export function mensagemJaEnviado(nomeMes: string | null): string {
  return nomeMes
    ? `${comMaiuscula(nomeMes)} deste job já foi enviado para faturamento.`
    : "Este job já foi enviado para faturamento.";
}
