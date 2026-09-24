"use server";

/** SAVE no job — e por isso, ERRATA.
 *
 *  Decisão do Tiago em 26/08/2026: depois da abertura, marcar uma linha
 *  como save ou definir de onde ela puxa saldo **alteram o faturamento
 *  previsto e o valor do job**. É exatamente o que a errata existe para
 *  registrar, então os dois passam por ela — com o "antes" e o "depois"
 *  dos dois números, como qualquer outra alteração do orçado.
 *
 *  A errata do save não muda tipo de custo nem valor unitário: a linha
 *  continua a mesma, o que muda é de qual lado da conta ela entra. Por
 *  isso `total_de` e `total_para` saem iguais no histórico, e quem conta
 *  a história são os dois campos de efeito.
 *
 *  ⚠️ Desde 22/09/2026 (decisão 099) toda mudança de save num job ABERTO é
 *  um PEDIDO que o administrador ou o financeiro aprova. Nada aqui grava a
 *  linha, a errata ou os números do job pelo PostgREST: tudo passa pelas
 *  RPCs SECURITY DEFINER (`save_pedir`, `cancelar_pedido_save`,
 *  `save_retirar`, `save_retirar_nao_enviado`, `save_enviar_pendentes`),
 *  que fazem a linha, o pedido, a errata e os espelhos numa transação só —
 *  o fluxo antigo gravava a errata antes e deixava registro fantasma
 *  quando a linha falhava. As mensagens de erro delas já chegam em pt-BR e
 *  vão direto para a tela.
 *
 *  Os números que acompanham cada pedido são os do FINANCEIRO
 *  (`totaisDoFinanceiro`): a produção vê o pedido na hora, o financeiro só
 *  na aprovação.
 *
 *  O job DEVOLVIDO (`rejeitado_financeiro`) é a exceção: a cópia dele
 *  continua editável direto, sem pedido e sem errata, e os espelhos são
 *  refeitos no reenvio (`enviarJobParaAbertura`).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import {
  MENSAGEM_CONSUMO_JA_ENVIADO,
  jobJaEnviadoParaFaturamento,
  mensagemConsumoMesJaEnviado,
  mesesEnviadosDoJob,
} from "@/lib/data/envio-faturamento";
import { nomeDoMes } from "@/lib/calculos/meses-trimestre";
import type { VersaoTotais } from "@/lib/calculos/versao-totais";
import {
  totaisParaRpc,
  type TotaisParaRpc,
  lerBaseDosEspelhos,
  totaisDoFinanceiro,
  type BaseDosEspelhos,
  type LinhaDoEspelho,
} from "@/lib/data/espelhos-do-job";
import { revisaoPendenteDoJob } from "@/lib/data/saves";
import type {
  JobStatus,
  OrigemDeSave,
  SaveAprovacaoMomento,
  SaveAprovacaoSituacao,
  SaveAprovacaoTipo,
} from "@/lib/types";

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string };

const dinheiro = (n: number) => Number(n.toFixed(2));

type Supabase = ReturnType<typeof createClient>;

/** A mudança que a errata vai registrar. Exatamente uma das duas. */
export type MudancaDeSave =
  | { tipo: "marcar"; emSave: boolean }
  | { tipo: "consumo"; origens: { jobOrigemId: string; valor: number }[] };

// ---------------------------------------------------------------------------
// Peças comuns
// ---------------------------------------------------------------------------

/** Os números antes → depois que o pop-up de aprovação mostra (`p_numeros`
 *  das RPCs). */
interface NumerosDoPedido {
  valor_job_antes: number;
  valor_job_depois: number;
  faturamento_previsto_antes: number;
  faturamento_previsto_depois: number;
}

/** A errata de save que as RPCs gravam (`p_errata`). */
interface ErrataDeSave extends NumerosDoPedido {
  titulo: string;
  custo_orcado_antes: number;
  custo_orcado_depois: number;
}

function numerosDe(antes: VersaoTotais, depois: VersaoTotais): NumerosDoPedido {
  return {
    valor_job_antes: dinheiro(antes.valorJob),
    valor_job_depois: dinheiro(depois.valorJob),
    faturamento_previsto_antes: dinheiro(antes.faturamentoPrevisto),
    faturamento_previsto_depois: dinheiro(depois.faturamentoPrevisto),
  };
}

function errataDe(
  titulo: string,
  antes: VersaoTotais,
  depois: VersaoTotais,
): ErrataDeSave {
  return {
    titulo,
    custo_orcado_antes: dinheiro(antes.subtotalGeral),
    custo_orcado_depois: dinheiro(depois.subtotalGeral),
    ...numerosDe(antes, depois),
  };
}

/** Os títulos da errata de save, os mesmos desde 26/08/2026. */
const tituloGera = (item: string) => `Save: "${item}" vira crédito`;
const tituloDeixaDeGerar = (item: string) => `Save: "${item}" deixa de ser crédito`;
const tituloConsome = (item: string) =>
  `Save: "${item}" passa a ser paga por saldo de outro job`;
const tituloDeixaDeConsumir = (item: string) => `Save: "${item}" deixa de consumir saldo`;

/** O save só muda com o job aberto (decisão 099): gerar até o envio para
 *  encerramento, consumir até o envio para faturamento (porta abaixo). */
function jobAceitaSave(status: JobStatus): boolean {
  return status === "aberto" || status === "em_producao";
}

function mensagemJobNaoMudaSave(status: JobStatus): string {
  switch (status) {
    case "encerrado":
    case "finalizado":
      return "Job enviado para encerramento não muda o save: os números dele estão congelados.";
    case "cancelado":
      return "Job cancelado não muda o save.";
    default:
      // Pré-abertura: o pop-up de save é só leitura até o financeiro abrir
      // o job (decisão 099, §18); o save do orçamento segue com a abertura.
      return "O save deste job só muda depois que o financeiro abrir o job. Até lá, o pop-up de save é só leitura.";
  }
}

const MENSAGEM_TIRAR_SAVE =
  "Para tirar o save desta linha, use “Retirar” no pop-up de save — ou “Cancelar pedido”, se ele ainda aguarda a aprovação do financeiro.";
const MENSAGEM_TIRAR_CONSUMO =
  "Para tirar o consumo de save desta linha, use “Retirar” no pop-up de save — ou “Cancelar pedido”, se ele ainda aguarda a aprovação do financeiro.";

interface JobLido {
  id: string;
  status: JobStatus;
  responsavel_id: string | null;
}

async function lerStatusDoJob(
  supabase: Supabase,
  tenantId: string,
  jobId: string,
): Promise<JobLido | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, status, responsavel_id")
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle<JobLido>();
  if (error) console.error("[save.job]", error.message);
  return data ?? null;
}

/** Um pedido de save, com o mínimo que as actions daqui precisam. */
interface PedidoLido {
  id: string;
  job_item_orcado_id: string | null;
  item_descricao: string;
  tipo: SaveAprovacaoTipo;
  situacao: SaveAprovacaoSituacao;
  momento: SaveAprovacaoMomento;
  origens_antes: OrigemDeSave[];
}

async function lerPedido(
  supabase: Supabase,
  tenantId: string,
  jobId: string,
  pedidoId: string,
): Promise<PedidoLido | null> {
  const { data, error } = await supabase
    .from("saves_aprovacoes")
    .select("id, job_item_orcado_id, item_descricao, tipo, situacao, momento, origens_antes")
    .eq("id", pedidoId)
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle<PedidoLido>();
  if (error) console.error("[save.pedido]", error.message);
  return data ?? null;
}

/**
 * A porta do CONSUMO (decisão 099, §14): consumir, editar o consumo e
 * retirá-lo ficam fechados depois do envio para faturamento — no modelo
 * mensal, só no mês da linha. Gerar save não passa por aqui: vale até o
 * envio para encerramento. Devolve a mensagem de recusa, ou `null`.
 */
async function portaDoConsumo(
  supabase: Supabase,
  tenantId: string,
  jobId: string,
  base: BaseDosEspelhos,
  grupoId: string | null,
): Promise<string | null> {
  if (base.modeloPlanilha !== "mensal") {
    return (await jobJaEnviadoParaFaturamento(supabase, jobId, tenantId))
      ? MENSAGEM_CONSUMO_JA_ENVIADO
      : null;
  }

  const falhou =
    "Não foi possível conferir os meses enviados para faturamento. Tente de novo.";
  let enviados: Set<string>;
  try {
    enviados = await mesesEnviadosDoJob(supabase, jobId, tenantId);
  } catch {
    return falhou;
  }
  if (enviados.size === 0 || !grupoId) return null;

  const { data: grupo, error: grupoErr } = await supabase
    .from("versoes_orcamento_grupos")
    .select("mes_id")
    .eq("id", grupoId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ mes_id: string | null }>();
  // Sem saber o mês da linha, trava: é o lado seguro da porta.
  if (grupoErr) return falhou;
  if (!grupo?.mes_id) return null;

  const { data: mes, error: mesErr } = await supabase
    .from("versoes_orcamento_meses")
    .select("mes")
    .eq("id", grupo.mes_id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ mes: string }>();
  if (mesErr) return falhou;
  if (mes && enviados.has(mes.mes)) {
    return mensagemConsumoMesJaEnviado([nomeDoMes(mes.mes)]);
  }
  return null;
}

/**
 * As origens de um consumo têm de ser jobs do MESMO TENANT e do MESMO
 * CLIENTE (`projetos.cliente_id`) do job que consome (decisão 099,
 * 22/09/2026). A tela só oferece os saldos do cliente, mas a action chamada
 * direto aceitava qualquer origem — e o banco confere o saldo, não o
 * cliente. Uma consulta só: o job e as origens, com o cliente de cada um.
 * A leitura de `jobs` passa pela mesma RLS da lista de saldos
 * (`vw_saves_por_job` é `security_invoker`): origem que o usuário não
 * enxerga não estava na lista e é recusada. Devolve a mensagem de recusa,
 * ou `null`.
 */
async function conferirOrigensDoCliente(
  supabase: Supabase,
  tenantId: string,
  jobId: string,
  origens: OrigemDeSave[],
): Promise<string | null> {
  if (origens.length === 0) return null;
  const ids = [...new Set([jobId, ...origens.map((o) => o.job_origem_id)])];
  const { data, error } = await supabase
    .from("jobs")
    .select("id, projeto:projetos(cliente_id)")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  if (error) {
    console.error("[save.origens.cliente]", error.message);
    return "Não foi possível conferir os jobs de origem do consumo. Tente de novo.";
  }
  const clienteDe = new Map<string, string | null>();
  for (const j of (data ?? []) as unknown as {
    id: string;
    projeto: { cliente_id: string | null } | null;
  }[]) {
    clienteDe.set(j.id, j.projeto?.cliente_id ?? null);
  }
  const clienteDoJob = clienteDe.get(jobId) ?? null;
  if (!clienteDoJob) {
    return "Não foi possível conferir o cliente deste job. Tente de novo.";
  }
  for (const o of origens) {
    if (!clienteDe.has(o.job_origem_id)) {
      return "Um dos jobs de origem do consumo não foi encontrado.";
    }
    if (clienteDe.get(o.job_origem_id) !== clienteDoJob) {
      return "O consumo de save só pode usar saldo de jobs do mesmo cliente deste job.";
    }
  }
  return null;
}

/** A linha sem o save ou sem o consumo — o "depois" de retirar ou de
 *  cancelar um pedido de outro momento. */
function semOSave(
  itens: LinhaDoEspelho[],
  linhaId: string,
  tipo: SaveAprovacaoTipo,
  consumoQueFica = 0,
): LinhaDoEspelho[] {
  return itens.map((i) =>
    i.id !== linhaId
      ? i
      : tipo === "gera"
        ? { ...i, em_save: false }
        : { ...i, save_consumido: consumoQueFica },
  );
}

function revalidarTelasDoSave(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  // As mesmas três telas da errata comum: a do job, o registro da
  // abertura e o mural — que passa a listar este job na faixa Saves (ou
  // Erratas).
  revalidatePath(`/financeiro/jobs/${jobId}`);
  revalidatePath("/financeiro/abertura-de-job");
}

// ---------------------------------------------------------------------------
// Pedir (errata de save num job aberto)
// ---------------------------------------------------------------------------

/**
 * Aplica uma mudança de save num item do job.
 *
 * Job ABERTO (`aberto`, `em_producao`): marcar a linha como save, ou fazê-la
 * consumir saldo (valor > 0), vira pedido de aprovação — `save_pedir`, com
 * `momento = 'job_aberto'`. A RPC muda a linha, grava a errata e põe o job
 * em revisão numa transação só, e NÃO mexe nos espelhos: o financeiro só
 * passa a contar a linha na aprovação. Tirar o save ou o consumo não é
 * pedido: é "Retirar" (`retirarSave`) ou "Cancelar pedido"
 * (`cancelarPedidoDeSave`).
 *
 * Job DEVOLVIDO: grava direto na cópia, sem pedido, sem errata e sem mexer
 * nos espelhos — o reenvio os refaz. Aqui tirar é permitido.
 *
 * Qualquer outro status: recusa (pré-abertura e encerrado são só leitura).
 */
export async function registrarErrataDeSave(
  jobId: string,
  jobItemOrcadoId: string,
  mudanca: MudancaDeSave,
): Promise<ActionResult> {
  const session = await requireSession();
  // É uma errata que muda saldo entre jobs — gate específico do save.
  const gate = await checarPermissao(session, "jobs.consumir_save");
  if (!gate.ok) return gate;
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // Uma entrada por origem, só valores positivos — a mesma forma que a RPC
  // grava. O consumo vazio é "tirar o consumo".
  const origens: OrigemDeSave[] = [];
  if (mudanca.tipo === "consumo") {
    const porOrigem = new Map<string, number>();
    for (const o of mudanca.origens) {
      const valor = Number(o.valor || 0);
      if (!o.jobOrigemId || !(valor > 0)) continue;
      porOrigem.set(o.jobOrigemId, (porOrigem.get(o.jobOrigemId) ?? 0) + valor);
    }
    for (const [job_origem_id, valor] of porOrigem) {
      origens.push({ job_origem_id, valor: dinheiro(valor) });
    }
    if (origens.some((o) => o.job_origem_id === jobId)) {
      return { ok: false, message: "Um job não pode consumir o próprio saldo de save." };
    }
  }

  // O status do job e o cliente das origens são leituras independentes.
  const [job, origemRecusada] = await Promise.all([
    lerStatusDoJob(supabase, tenantId, jobId),
    conferirOrigensDoCliente(supabase, tenantId, jobId, origens),
  ]);
  if (!job) return { ok: false, message: "Job não encontrado." };
  if (job.status !== "rejeitado_financeiro" && !jobAceitaSave(job.status)) {
    return { ok: false, message: mensagemJobNaoMudaSave(job.status) };
  }
  // Vale também para o job devolvido, que grava direto na cópia.
  if (origemRecusada) return { ok: false, message: origemRecusada };

  if (job.status === "rejeitado_financeiro") {
    return gravarNoJobDevolvido(
      supabase,
      tenantId,
      session.profile.id,
      jobId,
      jobItemOrcadoId,
      mudanca,
      origens,
    );
  }

  if (mudanca.tipo === "marcar" && !mudanca.emSave) {
    return { ok: false, message: MENSAGEM_TIRAR_SAVE };
  }
  if (mudanca.tipo === "consumo" && origens.length === 0) {
    return { ok: false, message: MENSAGEM_TIRAR_CONSUMO };
  }

  const lida = await lerBaseDosEspelhos(supabase, tenantId, jobId);
  if (!lida.ok) return lida;
  const base = lida.base;
  const alvo = base.itens.find((i) => i.id === jobItemOrcadoId);
  if (!alvo) return { ok: false, message: "Linha não encontrada neste job." };

  const totalConsumo = origens.reduce((s, o) => s + o.valor, 0);

  if (mudanca.tipo === "marcar" && alvo.save_consumido > 0) {
    return {
      ok: false,
      message:
        "Esta linha é paga por saldo de save de outro job. Retire o consumo antes de transformá-la em save.",
    };
  }
  if (mudanca.tipo === "consumo" && alvo.em_save) {
    return {
      ok: false,
      message:
        "Uma linha não pode gerar e consumir save ao mesmo tempo. Retire o save desta linha primeiro.",
    };
  }
  if (totalConsumo > alvo.total_orcado + 0.005) {
    return {
      ok: false,
      message: "O consumo de save não pode passar do orçado da linha.",
    };
  }

  if (mudanca.tipo === "consumo") {
    const barrado = await portaDoConsumo(supabase, tenantId, jobId, base, alvo.grupo_id);
    if (barrado) return { ok: false, message: barrado };
  }

  // ---- os dois fechamentos, como o FINANCEIRO vê ----
  // Antes: as linhas de agora. Depois: com a mudança aplicada — é o que o
  // financeiro passa a ver se aprovar. Os pedidos que já aguardam
  // continuam de fora dos dois lados.
  const depoisItens = base.itens.map((i) =>
    i.id !== alvo.id
      ? i
      : mudanca.tipo === "marcar"
        ? { ...i, em_save: true }
        : { ...i, save_consumido: totalConsumo },
  );
  const antes = totaisDoFinanceiro(base.itens, base);
  const depois = totaisDoFinanceiro(depoisItens, base);

  // Save de linha zerada não muda número nenhum: não vale um pedido. No
  // consumo a troca de origem com o mesmo valor é pedido de verdade (muda
  // de qual job sai o saldo), e a RPC recusa o consumo que não mudou.
  const mexeu =
    Math.abs(antes.valorJob - depois.valorJob) > 0.005 ||
    Math.abs(antes.faturamentoPrevisto - depois.faturamentoPrevisto) > 0.005;
  if (mudanca.tipo === "marcar" && !mexeu) {
    return {
      ok: false,
      message: "Esta mudança não altera o valor do job nem o faturamento.",
    };
  }

  const tipo: SaveAprovacaoTipo = mudanca.tipo === "marcar" ? "gera" : "consome";
  const errata = errataDe(
    tipo === "gera" ? tituloGera(alvo.item) : tituloConsome(alvo.item),
    antes,
    depois,
  );

  const { data: pedidoId, error } = await supabase.rpc("save_pedir", {
    p_job_item_orcado_id: alvo.id,
    p_tipo: tipo,
    p_origens: origens,
    p_numeros: numerosDe(antes, depois),
    p_errata: errata,
  });
  if (error) {
    console.error("[save.pedir]", error.message);
    // As mensagens da RPC e dos triggers (saldo, PP, BV, pedido em aberto)
    // já nomeiam o problema em pt-BR.
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "save.pedido.enviado",
    tenantId,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      pedido_id: pedidoId,
      job_item_orcado_id: alvo.id,
      item: alvo.item,
      tipo,
      momento: "job_aberto",
      valor: tipo === "gera" ? dinheiro(alvo.total_orcado) : dinheiro(totalConsumo),
      origens,
      titulo: errata.titulo,
      valor_job_antes: errata.valor_job_antes,
      valor_job_depois: errata.valor_job_depois,
      faturamento_previsto_antes: errata.faturamento_previsto_antes,
      faturamento_previsto_depois: errata.faturamento_previsto_depois,
    },
  });

  revalidarTelasDoSave(jobId);
  return { ok: true };
}

/**
 * Job devolvido pelo financeiro (decisão 099, §11): a cópia é editável
 * direto, como na pré-abertura de antes da aprovação de save. Não há
 * pedido nem errata — o job ainda não foi aberto —, e os espelhos ficam
 * como estão: o reenvio os recalcula pela cópia.
 */
async function gravarNoJobDevolvido(
  supabase: Supabase,
  tenantId: string,
  profileId: string,
  jobId: string,
  jobItemOrcadoId: string,
  mudanca: MudancaDeSave,
  origens: OrigemDeSave[],
): Promise<ActionResult> {
  const { data: linha, error: linhaErr } = await supabase
    .from("jobs_itens_orcado")
    .select("id, item, em_save, save_consumido, total_orcado")
    .eq("id", jobItemOrcadoId)
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      item: string;
      em_save: boolean;
      save_consumido: number | null;
      total_orcado: number | null;
    }>();
  if (linhaErr) console.error("[save.devolvido.linha]", linhaErr.message);
  if (!linha) return { ok: false, message: "Linha não encontrada neste job." };

  if (mudanca.tipo === "marcar") {
    if (mudanca.emSave && Number(linha.save_consumido ?? 0) > 0) {
      return {
        ok: false,
        message:
          "Esta linha é paga por saldo de save de outro job. Remova o consumo antes de transformá-la em save.",
      };
    }
    if (linha.em_save !== mudanca.emSave) {
      const { error } = await supabase
        .from("jobs_itens_orcado")
        .update({ em_save: mudanca.emSave })
        .eq("id", linha.id)
        .eq("tenant_id", tenantId);
      if (error) {
        console.error("[save.devolvido.marcar]", error.message);
        // O trigger da linha nomeia o motivo (PP, BV, consumo).
        return { ok: false, message: error.message };
      }
      await logAuditEvent({
        acao: mudanca.emSave ? "save.linha.marcada" : "save.linha.desmarcada",
        tenantId,
        entidadeTipo: "job",
        entidadeId: jobId,
        metadata: {
          job_item_orcado_id: linha.id,
          item: linha.item,
          origem: "job_devolvido",
        },
      });
    }
    revalidarTelasDoSave(jobId);
    return { ok: true };
  }

  const totalConsumo = origens.reduce((s, o) => s + o.valor, 0);
  if (totalConsumo > 0 && linha.em_save) {
    return {
      ok: false,
      message:
        "Uma linha não pode gerar e consumir save ao mesmo tempo. Desmarque o save desta linha primeiro.",
    };
  }
  if (totalConsumo > Number(linha.total_orcado ?? 0) + 0.005) {
    return {
      ok: false,
      message: "O consumo de save não pode passar do orçado da linha.",
    };
  }

  // O consumo de antes, para devolvê-lo se o novo for recusado pelo banco:
  // apagar e inserir são duas chamadas, e a linha não pode ficar sem nada.
  const { data: anteriores, error: antErr } = await supabase
    .from("saves_consumos")
    .select("job_origem_id, valor")
    .eq("job_item_orcado_id", linha.id)
    .eq("tenant_id", tenantId);
  if (antErr) {
    console.error("[save.devolvido.consumo_ler]", antErr.message);
    return { ok: false, message: "Não foi possível ler o consumo de save da linha." };
  }

  const { error: delErr } = await supabase
    .from("saves_consumos")
    .delete()
    .eq("job_item_orcado_id", linha.id)
    .eq("tenant_id", tenantId);
  if (delErr) {
    console.error("[save.devolvido.consumo_limpar]", delErr.message);
    return { ok: false, message: "Falha ao atualizar o consumo." };
  }

  const inserir = (lista: { job_origem_id: string; valor: number }[]) =>
    supabase.from("saves_consumos").insert(
      lista.map((o) => ({
        tenant_id: tenantId,
        job_origem_id: o.job_origem_id,
        job_item_orcado_id: linha.id,
        valor: Number(o.valor),
        created_by: profileId,
      })),
    );

  if (origens.length > 0) {
    const { error: insErr } = await inserir(origens);
    if (insErr) {
      console.error("[save.devolvido.consumo]", insErr.message);
      const antes = (anteriores ?? []) as { job_origem_id: string; valor: number }[];
      if (antes.length > 0) {
        const { error: volta } = await inserir(antes);
        if (volta) console.error("[save.devolvido.consumo_devolver]", volta.message);
      }
      // A mensagem do trigger nomeia o job e os valores.
      return { ok: false, message: insErr.message };
    }
  }

  await logAuditEvent({
    acao: "save.consumo.definido",
    tenantId,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      job_item_orcado_id: linha.id,
      item: linha.item,
      origens,
      total: dinheiro(totalConsumo),
      origem: "job_devolvido",
    },
  });

  revalidarTelasDoSave(jobId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cancelar, retirar e enviar (decisão 099)
// ---------------------------------------------------------------------------

/** Cancela um pedido de save que ainda aguarda o financeiro: a linha volta
 *  ao estado de logo antes do pedido e sai da fila.
 *
 *  - Pedido `job_aberto`: o financeiro ainda não contava a linha, então os
 *    espelhos não mudam e não há errata. A errata que o pedido abriu fica
 *    no histórico; se ela era a única pendência da revisão da abertura, a
 *    revisão se encerra sozinha (`p_revisao = 'fechar'`).
 *  - Pedido de outro momento (abertura, reenvio, legado): o financeiro já
 *    contava a linha, então cancelar é errata de save — espelhos da linha
 *    revertida e o antes → depois dos números.
 *
 *  Pedido de CONSUMO passa pela porta do consumo, como a retirada
 *  (decisão 099, §14): fechada depois do envio para faturamento; no modelo
 *  mensal, depois do envio do mês da linha. */
export async function cancelarPedidoDeSave(
  jobId: string,
  pedidoId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.consumir_save");
  if (!gate.ok) return gate;
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const [job, pedido] = await Promise.all([
    lerStatusDoJob(supabase, tenantId, jobId),
    lerPedido(supabase, tenantId, jobId, pedidoId),
  ]);
  if (!job) return { ok: false, message: "Job não encontrado." };
  if (!pedido) return { ok: false, message: "Pedido de save não encontrado." };
  if (!jobAceitaSave(job.status)) {
    return { ok: false, message: mensagemJobNaoMudaSave(job.status) };
  }
  if (pedido.situacao !== "aguardando") {
    return { ok: false, message: "Só um pedido que aguarda aprovação pode ser cancelado." };
  }

  let pTotais: TotaisParaRpc | null = null;
  let pErrata: ErrataDeSave | null = null;
  let pRevisao: "manter" | "fechar" = "manter";

  // A base dos espelhos serve a duas coisas: a porta do consumo (o mês da
  // linha, no mensal) e a errata do pedido de outro momento. A revisão só
  // importa ao pedido do job aberto. Leituras independentes, em paralelo.
  const precisaBase = pedido.tipo === "consome" || pedido.momento !== "job_aberto";
  const [lida, revisao] = await Promise.all([
    precisaBase ? lerBaseDosEspelhos(supabase, tenantId, jobId) : Promise.resolve(null),
    pedido.momento === "job_aberto"
      ? revisaoPendenteDoJob(supabase, tenantId, jobId, pedido.id)
      : Promise.resolve(null),
  ]);
  if (lida && !lida.ok) return lida;
  const base = lida?.base ?? null;

  // Cancelar um pedido de CONSUMO mexe no consumo da linha e passa pela
  // mesma porta da retirada (decisão 099, §13 e §14): fechada depois do
  // envio para faturamento; no modelo mensal, depois do envio do mês da
  // linha. Linha removida (FK SET NULL): sem mês, vale só a porta do job.
  if (pedido.tipo === "consome" && base) {
    const linha = pedido.job_item_orcado_id
      ? base.itens.find((i) => i.id === pedido.job_item_orcado_id)
      : undefined;
    const barrado = await portaDoConsumo(
      supabase,
      tenantId,
      jobId,
      base,
      linha?.grupo_id ?? null,
    );
    if (barrado) return { ok: false, message: barrado };
  }

  if (pedido.momento === "job_aberto") {
    pRevisao = revisao?.podeFechar ? "fechar" : "manter";
  } else if (base) {
    const consumoAntes = (pedido.origens_antes ?? []).reduce(
      (s, o) => s + Number(o.valor ?? 0),
      0,
    );
    // Linha removida (a FK é SET NULL): nada a reverter, os números ficam.
    const depoisItens = pedido.job_item_orcado_id
      ? semOSave(base.itens, pedido.job_item_orcado_id, pedido.tipo, consumoAntes)
      : base.itens;
    const antes = totaisDoFinanceiro(base.itens, base);
    const depois = totaisDoFinanceiro(depoisItens, base);
    // No mensal leva junto a parte de save dos meses já enviados.
    pTotais = totaisParaRpc(depoisItens, base);
    pErrata = errataDe(
      pedido.tipo === "gera"
        ? tituloDeixaDeGerar(pedido.item_descricao)
        : tituloDeixaDeConsumir(pedido.item_descricao),
      antes,
      depois,
    );
    // A errata que a RPC grava já põe o job em revisão.
  }

  const { error } = await supabase.rpc("cancelar_pedido_save", {
    p_id: pedido.id,
    p_totais: pTotais,
    p_errata: pErrata,
    p_revisao: pRevisao,
  });
  if (error) {
    console.error("[save.cancelar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "save.pedido.cancelado",
    tenantId,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      pedido_id: pedido.id,
      job_item_orcado_id: pedido.job_item_orcado_id,
      item: pedido.item_descricao,
      tipo: pedido.tipo,
      momento: pedido.momento,
      revisao: pRevisao,
      espelhos: pTotais,
      ...(pErrata
        ? {
            titulo: pErrata.titulo,
            valor_job_antes: pErrata.valor_job_antes,
            valor_job_depois: pErrata.valor_job_depois,
            faturamento_previsto_antes: pErrata.faturamento_previsto_antes,
            faturamento_previsto_depois: pErrata.faturamento_previsto_depois,
          }
        : {}),
    },
  });

  revalidarTelasDoSave(jobId);
  return { ok: true };
}

/** Retira o save ou o consumo de uma linha.
 *  - `{ pedidoId }` aprovado: errata de save (os números do financeiro mudam
 *    na hora e o job volta para a revisão da abertura);
 *  - `{ pedidoId }` recusado: só arquiva a recusa;
 *  - `{ jobItemOrcadoId }`: linha com save ou consumo nunca enviado.
 *
 *  Portas (decisão 099, §13 e §14): o save gerado sai até o envio para
 *  encerramento (o status); o consumo, até o envio para faturamento — no
 *  modelo mensal, até o envio do mês da linha. Save aprovado cujo saldo já
 *  começou a ser consumido não sai: o banco recusa com a mensagem. */
export async function retirarSave(
  jobId: string,
  alvo: { pedidoId: string } | { jobItemOrcadoId: string },
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.consumir_save");
  if (!gate.ok) return gate;
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const [job, pedido] = await Promise.all([
    lerStatusDoJob(supabase, tenantId, jobId),
    "pedidoId" in alvo
      ? lerPedido(supabase, tenantId, jobId, alvo.pedidoId)
      : Promise.resolve(null),
  ]);
  if (!job) return { ok: false, message: "Job não encontrado." };
  if (!jobAceitaSave(job.status)) {
    return { ok: false, message: mensagemJobNaoMudaSave(job.status) };
  }

  // ---- Recusado: só arquiva ----
  // Sem porta de data: os números já voltaram na recusa, e arquivar só
  // destrava a linha (errata, PP e BV).
  if ("pedidoId" in alvo) {
    if (!pedido) return { ok: false, message: "Pedido de save não encontrado." };
    if (pedido.situacao === "recusado") {
      const { error } = await supabase.rpc("save_retirar", {
        p_id: pedido.id,
        p_totais: null,
        p_errata: null,
      });
      if (error) {
        console.error("[save.arquivar]", error.message);
        return { ok: false, message: error.message };
      }
      await logAuditEvent({
        acao: "save.pedido.arquivado",
        tenantId,
        entidadeTipo: "job",
        entidadeId: jobId,
        metadata: {
          pedido_id: pedido.id,
          job_item_orcado_id: pedido.job_item_orcado_id,
          item: pedido.item_descricao,
          tipo: pedido.tipo,
        },
      });
      revalidarTelasDoSave(jobId);
      return { ok: true };
    }
    if (pedido.situacao === "aguardando") {
      return {
        ok: false,
        message: "Este pedido ainda aguarda a aprovação do financeiro: use “Cancelar pedido”.",
      };
    }
    if (pedido.situacao !== "aprovado") {
      return { ok: false, message: "Este pedido de save já foi encerrado." };
    }
    if (!pedido.job_item_orcado_id) {
      return { ok: false, message: "A linha deste save foi removida." };
    }
  }

  const lida = await lerBaseDosEspelhos(supabase, tenantId, jobId);
  if (!lida.ok) return lida;
  const base = lida.base;

  const linhaId =
    "pedidoId" in alvo ? (pedido!.job_item_orcado_id as string) : alvo.jobItemOrcadoId;
  const linha = base.itens.find((i) => i.id === linhaId);
  if (!linha) return { ok: false, message: "Linha não encontrada neste job." };

  // Aprovado: o tipo é o do pedido. Nunca enviado: o que a linha tem.
  let tipo: SaveAprovacaoTipo;
  if (pedido) {
    tipo = pedido.tipo;
  } else if (linha.em_save) {
    tipo = "gera";
  } else if (linha.save_consumido > 0) {
    tipo = "consome";
  } else {
    return { ok: false, message: "Esta linha não tem save nem consumo de save." };
  }

  // Pedido que aguarda na mesma linha (a edição de um consumo aprovado,
  // por exemplo) sai antes: retirar por baixo dele deixaria o pedido
  // descrevendo uma linha que não existe mais.
  if (base.pedidos.some((p) => p.jobItemOrcadoId === linha.id)) {
    return {
      ok: false,
      message:
        "Esta linha tem pedido de save aguardando aprovação: cancele o pedido antes de retirar.",
    };
  }

  if (tipo === "consome") {
    const barrado = await portaDoConsumo(supabase, tenantId, jobId, base, linha.grupo_id);
    if (barrado) return { ok: false, message: barrado };
  }

  // A RPC tira o consumo INTEIRO da linha, e desmarca o save gerado.
  const antes = totaisDoFinanceiro(base.itens, base);
  const depoisItens = semOSave(base.itens, linha.id, tipo, 0);
  const depois = totaisDoFinanceiro(depoisItens, base);
  // No mensal leva junto a parte de save dos meses já enviados.
  const pTotais = totaisParaRpc(depoisItens, base);
  const pErrata = errataDe(
    tipo === "gera" ? tituloDeixaDeGerar(linha.item) : tituloDeixaDeConsumir(linha.item),
    antes,
    depois,
  );

  const { error } = pedido
    ? await supabase.rpc("save_retirar", {
        p_id: pedido.id,
        p_totais: pTotais,
        p_errata: pErrata,
      })
    : await supabase.rpc("save_retirar_nao_enviado", {
        p_job_item_orcado_id: linha.id,
        p_totais: pTotais,
        p_errata: pErrata,
      });
  if (error) {
    console.error("[save.retirar]", error.message);
    // Inclui o "saldo já começou a ser consumido" do trigger da linha.
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "save.retirado",
    tenantId,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      pedido_id: pedido?.id ?? null,
      nao_enviado: pedido === null,
      job_item_orcado_id: linha.id,
      item: linha.item,
      tipo,
      espelhos: pTotais,
      titulo: pErrata.titulo,
      valor_job_antes: pErrata.valor_job_antes,
      valor_job_depois: pErrata.valor_job_depois,
      faturamento_previsto_antes: pErrata.faturamento_previsto_antes,
      faturamento_previsto_depois: pErrata.faturamento_previsto_depois,
    },
  });

  revalidarTelasDoSave(jobId);
  return { ok: true };
}

/** Botão "Enviar N saves para aprovação": o job aberto antes do fluxo manda
 *  as linhas com save ou consumo que nunca foram enviadas.
 *
 *  O financeiro já conta essas linhas nos espelhos (é o legado), então nada
 *  muda nos números nem na revisão: o pedido só registra a linha na fila.
 *  Os números antes → depois de cada linha são o efeito dela sozinha — o
 *  job sem aquele save (ou consumo) e o job como está —, na visão do
 *  financeiro. */
export async function enviarSavesParaAprovacao(
  jobId: string,
): Promise<{ ok: true; quantidade: number } | { ok: false; message: string }> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.consumir_save");
  if (!gate.ok) return gate;
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const job = await lerStatusDoJob(supabase, tenantId, jobId);
  if (!job) return { ok: false, message: "Job não encontrado." };
  if (!jobAceitaSave(job.status)) {
    return { ok: false, message: mensagemJobNaoMudaSave(job.status) };
  }

  const [lida, ativosRes] = await Promise.all([
    lerBaseDosEspelhos(supabase, tenantId, jobId),
    // As linhas que JÁ têm pedido — o mesmo recorte de
    // `save_enviar_pendentes`, que é quem decide de verdade.
    supabase
      .from("saves_aprovacoes")
      .select("job_item_orcado_id")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .in("situacao", ["aguardando", "aprovado", "recusado"]),
  ]);
  if (!lida.ok) return lida;
  if (ativosRes.error) {
    console.error("[save.enviar.pedidos]", ativosRes.error.message);
    return { ok: false, message: "Não foi possível ler os pedidos de save do job." };
  }
  const base = lida.base;
  const comPedido = new Set(
    ((ativosRes.data ?? []) as { job_item_orcado_id: string | null }[])
      .map((p) => p.job_item_orcado_id)
      .filter((id): id is string => Boolean(id)),
  );

  const pendentes = base.itens.filter(
    (i) => (i.em_save || i.save_consumido > 0) && !comPedido.has(i.id),
  );
  if (pendentes.length === 0) {
    return {
      ok: false,
      message: "Não há save nem consumo de save a enviar para aprovação neste job.",
    };
  }

  const agora = totaisDoFinanceiro(base.itens, base);
  const numeros: Record<string, NumerosDoPedido> = {};
  for (const l of pendentes) {
    const sem = totaisDoFinanceiro(
      semOSave(base.itens, l.id, l.em_save ? "gera" : "consome", 0),
      base,
    );
    numeros[l.id] = numerosDe(sem, agora);
  }

  const { data: quantidade, error } = await supabase.rpc("save_enviar_pendentes", {
    p_job_id: jobId,
    p_momento: "legado_botao",
    p_numeros: numeros,
  });
  if (error) {
    console.error("[save.enviar]", error.message);
    return { ok: false, message: error.message };
  }
  const qtd = Number(quantidade ?? 0);

  await logAuditEvent({
    acao: "save.pedido.enviado",
    tenantId,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      momento: "legado_botao",
      quantidade: qtd,
      linhas: pendentes.map((l) => ({
        job_item_orcado_id: l.id,
        item: l.item,
        tipo: l.em_save ? "gera" : "consome",
      })),
    },
  });

  revalidarTelasDoSave(jobId);
  return { ok: true, quantidade: qtd };
}
