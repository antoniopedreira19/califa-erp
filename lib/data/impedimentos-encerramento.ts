import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BV_SITUACAO_EM_ABERTO,
  PP_STATUS_EM_ABERTO,
  situacaoDaVerba,
  verbaPendenteNoEncerramento,
  type SituacaoVerba,
} from "@/lib/types";
import { TIPOS_QUE_GERAM_PP } from "@/lib/calculos/pps-item";
import { devolucaoDaVerba, prestacaoDaVerba } from "@/lib/data/prestacao-da-verba";

/**
 * O que impede o encerramento de um job AGORA. Vazio = pode encerrar.
 *
 * Uma régua só para três lugares que não podem discordar (decisão 105,
 * 25/09/2026): o envio para encerramento (`encerrarJob`), o card "Jobs
 * prontos pra encerrar" da home do GP e o filtro `encerrar_pronto` da
 * lista de jobs. Até aqui o card contava "job com envio para faturamento",
 * critério anterior à decisão 087, e mostrava como pronto um job que o
 * botão recusava — e nunca mostrava o job sem nada a faturar.
 *
 * Módulo comum (sem `"use server"`): export de arquivo de Server Action
 * vira endpoint chamável pelo navegador, e esta função confia no
 * `tenantId` de quem chama.
 *
 * Regra do time (13/08/2026): job não encerra com PP ou BV em aberto.
 * "Em aberto" é PP que ainda não foi paga e BV que ainda não foi recebido
 * — cancelada não conta, porque não é compromisso nem desembolso (a
 * rejeitada conta desde a decisão 083). E não encerra com item de custo em
 * aberto (decisão 052), com verba de produção sem prestação aprovada
 * (decisão 081 §7), com save ou consumo de save aguardando o financeiro ou
 * nunca enviado (decisão 099), nem com a revisão da abertura pendente.
 *
 * O FATURAMENTO não entra (decisão 087): faturamento e encerramento correm
 * separados, e o job sem nada a faturar finaliza só com o encerramento.
 *
 * Leitura que falhou trava a mais, nunca a menos.
 */
export interface ImpedimentosEncerramento {
  ppsEmAberto: { codigo: string; status: string }[];
  /** Verbas pagas que ainda não fecharam (decisão 081, pergunta 10a). */
  verbasEmAberto: { codigo: string; situacao: Exclude<SituacaoVerba, "concluida"> }[];
  bvsEmAberto: { item: string; situacao: string }[];
  /** Itens de custo que ainda não disseram se sairá mais PP deles
   *  (decisão 052). Só as linhas de calha PP fora do save — A e D não
   *  geram PP e não têm o que marcar. */
  itensSemMarcacao: { item: string }[];
  savesAguardando: { item: string }[];
  consumosAguardando: { item: string }[];
  /** `comRecusa`: a linha tem pedido recusado ainda não arquivado, e o
   *  botão "Enviar saves para aprovação" não a envia até o GP retirar a
   *  recusa. */
  savesNaoEnviados: { item: string; comRecusa: boolean }[];
  revisaoDaAberturaPendente: boolean;
}

/** Nenhum impedimento: o job pode ser enviado para encerramento. */
export function podeEncerrar(imp: ImpedimentosEncerramento): boolean {
  return (
    imp.ppsEmAberto.length === 0 &&
    imp.verbasEmAberto.length === 0 &&
    imp.bvsEmAberto.length === 0 &&
    imp.itensSemMarcacao.length === 0 &&
    imp.savesAguardando.length === 0 &&
    imp.consumosAguardando.length === 0 &&
    imp.savesNaoEnviados.length === 0 &&
    !imp.revisaoDaAberturaPendente
  );
}

function vazio(): ImpedimentosEncerramento {
  return {
    ppsEmAberto: [],
    verbasEmAberto: [],
    bvsEmAberto: [],
    itensSemMarcacao: [],
    savesAguardando: [],
    consumosAguardando: [],
    savesNaoEnviados: [],
    revisaoDaAberturaPendente: false,
  };
}

/**
 * Os impedimentos de VÁRIOS jobs de uma vez: sete leituras rasas em
 * paralelo, filtradas pelos ids, e o cruzamento em memória — o número de
 * consultas não cresce com a quantidade de jobs (`docs/PERFORMANCE.md`,
 * seções B e C). Cada leitura traz só as linhas que travam.
 *
 * Todo job pedido sai no mapa, mesmo sem impedimento nenhum.
 */
export async function impedimentosDosJobs(
  supabase: SupabaseClient,
  tenantId: string,
  jobIds: string[],
): Promise<Map<string, ImpedimentosEncerramento>> {
  const mapa = new Map<string, ImpedimentosEncerramento>();
  if (jobIds.length === 0) return mapa;
  for (const id of jobIds) mapa.set(id, vazio());

  const [
    jobsRes,
    ppsRes,
    verbasRes,
    bvsRes,
    semMarcacaoRes,
    pedidosSaveRes,
    linhasComSaveRes,
  ] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, abertura_em_revisao")
      .eq("tenant_id", tenantId)
      .in("id", jobIds),
    supabase
      .from("pedidos_compra")
      .select("job_id, codigo, status")
      .eq("tenant_id", tenantId)
      .in("job_id", jobIds)
      .in("status", PP_STATUS_EM_ABERTO),
    // Verba paga sem prestação aprovada (decisão 081, pergunta 10a; o
    // estorno por baixar deixou de travar em 22/09/2026). As dicas de FK
    // são as de `SELECT_PRESTACAO_DA_VERBA` — sem elas o embed é ambíguo.
    supabase
      .from("pedidos_compra")
      .select(
        "job_id, codigo, status, verba_producao, " +
          "prestacao:pp_verba_prestacoes!pp_verba_prestacoes_pedido_compra_id_fkey(status, valor_devolvido), " +
          "devolucao:pp_verba_devolucoes!pp_verba_devolucoes_pedido_compra_id_fkey(pago_em)",
      )
      .eq("tenant_id", tenantId)
      .in("job_id", jobIds)
      .eq("verba_producao", true)
      .eq("status", "pago"),
    // BV pendura na CÓPIA do job desde 27/08/2026. O `!inner` é filtro.
    supabase
      .from("itens_bv")
      .select("situacao, copia:jobs_itens_orcado!inner(item, job_id)")
      .eq("tenant_id", tenantId)
      .in("copia.job_id", jobIds)
      .in("situacao", BV_SITUACAO_EM_ABERTO),
    // O mesmo recorte de `lerItensSemConclusao` (decisão 052): âncora sem
    // o marco, em linha que gera PP e não está em save.
    supabase
      .from("jobs_itens_realizado")
      .select("job_id, copia:jobs_itens_orcado!inner(item, tipo_custo, em_save)")
      .eq("tenant_id", tenantId)
      .in("job_id", jobIds)
      .is("pps_concluidas_em", null)
      .in("copia.tipo_custo", TIPOS_QUE_GERAM_PP)
      .eq("copia.em_save", false),
    // Pedidos de save ativos (decisão 099): os que aguardam travam;
    // aguardando e aprovado dizem que o lado da linha já foi enviado; o
    // recusado não arquivado só diz que a linha tem recusa a retirar.
    supabase
      .from("saves_aprovacoes")
      .select("job_id, job_item_orcado_id, item_descricao, tipo, situacao")
      .eq("tenant_id", tenantId)
      .in("job_id", jobIds)
      .in("situacao", ["aguardando", "aprovado", "recusado"]),
    // As linhas que geram ou consomem save hoje.
    supabase
      .from("jobs_itens_orcado")
      .select("id, job_id, item, em_save, save_consumido")
      .eq("tenant_id", tenantId)
      .in("job_id", jobIds)
      .or("em_save.eq.true,save_consumido.gt.0"),
  ]);

  const de = (jobId: string | null | undefined) =>
    jobId ? mapa.get(jobId) : undefined;

  // Revisão da abertura. Leitura que falhou: todos travam.
  if (jobsRes.error) {
    console.error("[impedimentos.jobs]", jobsRes.error.message);
    for (const imp of mapa.values()) imp.revisaoDaAberturaPendente = true;
  } else {
    for (const j of (jobsRes.data ?? []) as { id: string; abertura_em_revisao: boolean | null }[]) {
      const imp = de(j.id);
      if (imp) imp.revisaoDaAberturaPendente = j.abertura_em_revisao === true;
    }
  }

  if (ppsRes.error) {
    console.error("[impedimentos.pps]", ppsRes.error.message);
    for (const imp of mapa.values()) {
      imp.ppsEmAberto.push({ codigo: "Pedidos de Produção", status: "gerada" });
    }
  } else {
    for (const p of (ppsRes.data ?? []) as { job_id: string; codigo: string; status: string }[]) {
      de(p.job_id)?.ppsEmAberto.push({ codigo: p.codigo, status: p.status });
    }
  }

  if (verbasRes.error) {
    console.error("[impedimentos.verbas]", verbasRes.error.message);
    for (const imp of mapa.values()) {
      imp.verbasEmAberto.push({ codigo: "Verbas de produção", situacao: "aguardando_prestacao" });
    }
  } else {
    for (const pp of (verbasRes.data ?? []) as any[]) {
      const situacao = situacaoDaVerba({
        verba_producao: pp.verba_producao === true,
        status: pp.status,
        prestacao: prestacaoDaVerba(pp.prestacao),
        devolucao: devolucaoDaVerba(pp.devolucao),
      });
      if (verbaPendenteNoEncerramento(situacao)) {
        de(pp.job_id)?.verbasEmAberto.push({ codigo: pp.codigo as string, situacao });
      }
    }
  }

  if (bvsRes.error) {
    console.error("[impedimentos.bvs]", bvsRes.error.message);
    for (const imp of mapa.values()) {
      imp.bvsEmAberto.push({ item: "BVs", situacao: "confirmado" });
    }
  } else {
    for (const b of (bvsRes.data ?? []) as any[]) {
      const copia = Array.isArray(b.copia) ? b.copia[0] : b.copia;
      de(copia?.job_id)?.bvsEmAberto.push({
        item: copia?.item ?? "Item",
        situacao: b.situacao,
      });
    }
  }

  if (semMarcacaoRes.error) {
    console.error("[impedimentos.sem_marcacao]", semMarcacaoRes.error.message);
    for (const imp of mapa.values()) {
      imp.itensSemMarcacao.push({
        item: "Itens de custo (não foi possível conferir; tente de novo)",
      });
    }
  } else {
    for (const linha of (semMarcacaoRes.data ?? []) as any[]) {
      const copia = Array.isArray(linha.copia) ? linha.copia[0] : linha.copia;
      de(linha.job_id)?.itensSemMarcacao.push({ item: (copia?.item as string) ?? "Item" });
    }
  }

  const pedidosSave = (pedidosSaveRes.data ?? []) as {
    job_id: string;
    job_item_orcado_id: string | null;
    item_descricao: string;
    tipo: "gera" | "consome";
    situacao: "aguardando" | "aprovado" | "recusado";
  }[];
  if (pedidosSaveRes.error) {
    console.error("[impedimentos.saves]", pedidosSaveRes.error.message);
    for (const imp of mapa.values()) imp.savesAguardando.push({ item: "pedidos de save" });
  } else {
    for (const p of pedidosSave) {
      if (p.situacao !== "aguardando") continue;
      const imp = de(p.job_id);
      if (!imp) continue;
      (p.tipo === "gera" ? imp.savesAguardando : imp.consumosAguardando).push({
        item: p.item_descricao,
      });
    }
  }

  // "Não enviado" é por LADO da linha (decisão 099, revisão de 22/09/2026):
  // save gerado sem pedido de gera aguardando ou aprovado, ou consumo sem
  // pedido de consumo aguardando ou aprovado. O recusado não conta como
  // envio.
  if (pedidosSaveRes.error || linhasComSaveRes.error) {
    if (linhasComSaveRes.error) {
      console.error("[impedimentos.linhas_save]", linhasComSaveRes.error.message);
    }
    for (const imp of mapa.values()) {
      imp.savesNaoEnviados.push({ item: "linhas com save", comRecusa: false });
    }
  } else {
    const enviado = (tipo: "gera" | "consome") =>
      new Set(
        pedidosSave
          .filter(
            (p) =>
              p.tipo === tipo &&
              (p.situacao === "aguardando" || p.situacao === "aprovado"),
          )
          .map((p) => p.job_item_orcado_id)
          .filter((id): id is string => Boolean(id)),
      );
    const geraEnviado = enviado("gera");
    const consomeEnviado = enviado("consome");
    const comRecusa = new Set(
      pedidosSave
        .filter((p) => p.situacao === "recusado")
        .map((p) => p.job_item_orcado_id)
        .filter((id): id is string => Boolean(id)),
    );
    for (const l of (linhasComSaveRes.data ?? []) as {
      id: string;
      job_id: string;
      item: string;
      em_save: boolean | null;
      save_consumido: number | string | null;
    }[]) {
      const naoEnviado =
        (l.em_save === true && !geraEnviado.has(l.id)) ||
        (Number(l.save_consumido ?? 0) > 0 && !consomeEnviado.has(l.id));
      if (naoEnviado) {
        de(l.job_id)?.savesNaoEnviados.push({ item: l.item, comRecusa: comRecusa.has(l.id) });
      }
    }
  }

  return mapa;
}
