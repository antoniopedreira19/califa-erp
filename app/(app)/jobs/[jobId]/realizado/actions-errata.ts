"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import {
  MENSAGEM_JA_ENVIADO,
  jobJaEnviadoParaFaturamento,
  mensagemMesJaEnviado,
  mesesEnviadosDoJob,
} from "@/lib/data/envio-faturamento";
import { nomeDoMes } from "@/lib/calculos/meses-trimestre";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import {
  calcularEfeitoDaMudanca,
  TIPOS_CUSTO,
  aceitaBV,
} from "@/lib/calculos/versao-totais";
import {
  espelhosDe,
  lerBaseDosEspelhos,
  totaisDoFinanceiro,
  type LinhaDoEspelho,
} from "@/lib/data/espelhos-do-job";
import type {
  TipoCusto,
  JobStatus,
  ErrataAcao,
  CategoriaModeloPlanilha,
} from "@/lib/types";
import { jobAceitaAcoesPlanilha } from "@/lib/types";

type Ok = { ok: true; errataId: string };
type Err = { ok: false; message: string };
type Result = Ok | Err;

const TIPOS = TIPOS_CUSTO;

interface AlvoTroca {
  copiaId: string;
  itemNome: string;
}

/**
 * Barra QUALQUER alteração em linha que já tem PP no financeiro.
 *
 * Regra do Tiago (02/09/2026, decisão 040): a errata não mexe em linha
 * onde uma PP já foi emitida — nem valor, nem QT, nem D/M, nem tipo. O
 * que já pesa no realizado não se reescreve por cima. "Emitida" aqui é a
 * PP que CHEGOU ao financeiro: em avaliação, rejeitada, aprovada ou paga.
 * A gerada (rascunho no job) e a cancelada não travam.
 *
 * Substitui a regra anterior, que só travava a troca de TIPO e deixava
 * valor, QT e D/M livres com PP ativa (handoff de Jobs, §20).
 *
 * Por item, não pela errata inteira: quem está corrigindo dez linhas não
 * perde o trabalho por causa de uma — a mensagem nomeia o item. A tela já
 * nasce travada nessas linhas (`linhaTravadaPorPP`, na tabela), então
 * chegar aqui é payload montado à mão ou tela desatualizada.
 *
 * Retorna a mensagem de bloqueio, ou null quando a errata pode seguir.
 */
async function barrarLinhaComPPNoFinanceiro(
  jobId: string,
  tenantId: string,
  alvos: AlvoTroca[],
): Promise<string | null> {
  const supabase = createClient();
  const copiaIds = alvos.map((a) => a.copiaId).filter(Boolean);
  if (copiaIds.length === 0) return null;

  const nomePorCopiaId = new Map(alvos.map((a) => [a.copiaId, a.itemNome]));

  // Realizado é a ponte entre a linha da planilha e a PP.
  const { data: realizados } = await supabase
    .from("jobs_itens_realizado")
    .select("id, job_item_orcado_id")
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .in("job_item_orcado_id", copiaIds);

  const copiaPorRealizado = new Map(
    (realizados ?? []).map((r: any) => [
      r.id as string,
      r.job_item_orcado_id as string,
    ]),
  );
  if (copiaPorRealizado.size === 0) return null;

  const { data: pps } = await supabase
    .from("pedidos_compra")
    .select("item_realizado_id, codigo, status")
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .not("status", "in", "(cancelada,gerada)")
    .in("item_realizado_id", Array.from(copiaPorRealizado.keys()));

  const pp = (pps ?? [])[0] as
    | { item_realizado_id: string; codigo: string; status: string }
    | undefined;
  if (!pp) return null;

  const copiaId = copiaPorRealizado.get(pp.item_realizado_id) ?? "";
  const nome = nomePorCopiaId.get(copiaId) ?? "o item";
  return `"${nome}" já tem o Pedido de Produção ${pp.codigo} no financeiro. Linha com PP emitida não entra em errata — corrija o que falta em outra linha, ou cancele a PP antes.`;
}

/**
 * Barra a errata em linha `A · Repasse` já marcada como concluída.
 *
 * O resguardo pedido pelo Tiago em 08/09/2026 (decisão 062). No `AR` a
 * soma das PPs precisa cobrir o orçado para o item fechar; deixar o
 * orçado se mover DEPOIS do fechamento quebraria a invariante por trás
 * das costas de quem já repassou.
 *
 * Na prática o caso quase não acontece — em custo A, AR e D o repasse só
 * sai depois de o cliente pagar, e a essa altura o job está faturado e a
 * errata já não abre. A trava existe para o "quase".
 *
 * Só o `AR`: em B, C, F e FI não há amarração entre PPs e orçado, e a
 * errata segue como a decisão 040 deixou. A trava de PP no financeiro,
 * essa sim, continua valendo para todos.
 */
async function barrarARConcluido(
  jobId: string,
  tenantId: string,
  alvos: AlvoTroca[],
): Promise<string | null> {
  const supabase = createClient();
  const copiaIds = alvos.map((a) => a.copiaId).filter(Boolean);
  if (copiaIds.length === 0) return null;

  const nomePorCopiaId = new Map(alvos.map((a) => [a.copiaId, a.itemNome]));

  const { data } = await supabase
    .from("jobs_itens_realizado")
    .select("job_item_orcado_id, copia:jobs_itens_orcado!inner(tipo_custo)")
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .in("job_item_orcado_id", copiaIds)
    .not("pps_concluidas_em", "is", null)
    .eq("copia.tipo_custo", "AR");

  const travada = (data ?? [])[0] as
    | { job_item_orcado_id: string }
    | undefined;
  if (!travada) return null;

  const nome = nomePorCopiaId.get(travada.job_item_orcado_id) ?? "o item";
  return `"${nome}" é custo A · Repasse e já foi marcado como concluído — as PPs dele fecham o orçado. Linha assim não entra em errata: reabra o item gerando uma PP nova antes de corrigir o orçado.`;
}

/**
 * Barra a troca de tipo de custo em item com BV já confirmado ou
 * recebido.
 *
 * Até 02/09/2026 esta função também barrava a troca de tipo em item com
 * PP ativa. Esse ramo saiu: `barrarLinhaComPPNoFinanceiro` trava a linha
 * inteira, o que inclui o tipo. Fica só o BV, que não tem outra porta.
 *
 * Por item, não pela errata inteira (decisão do time): quem está
 * corrigindo dez linhas não perde o trabalho por causa de uma.
 *
 * Retorna a mensagem de bloqueio, ou null quando a errata pode seguir.
 */
async function barrarTrocaDeTipo(
  jobId: string,
  tenantId: string,
  alvos: AlvoTroca[],
): Promise<string | null> {
  const supabase = createClient();
  const copiaIds = alvos.map((a) => a.copiaId).filter(Boolean);
  if (copiaIds.length === 0) return null;

  const nomePorCopiaId = new Map(alvos.map((a) => [a.copiaId, a.itemNome]));

  const { data: bvs } = await supabase
    .from("itens_bv")
    .select("job_item_orcado_id, situacao")
    .eq("tenant_id", tenantId)
    .in("job_item_orcado_id", copiaIds);

  const bvTravado = (bvs ?? []).find(
    (b: any) => b.situacao === "confirmado" || b.situacao === "recebido",
  ) as { job_item_orcado_id: string; situacao: string } | undefined;
  if (bvTravado) {
    const nome = nomePorCopiaId.get(bvTravado.job_item_orcado_id) ?? "o item";
    return bvTravado.situacao === "recebido"
      ? `"${nome}" tem BV já recebido. Não é possível mudar o tipo de custo deste item.`
      : `"${nome}" tem BV já confirmado e enviado ao financeiro. Cancele o BV antes de mudar o tipo de custo deste item.`;
  }

  return null;
}

/** Pedido de save que ainda prende a linha: aguardando o financeiro, ou
 *  recusado e ainda não retirado pelo GP (decisão 099). */
type PedidoQuePrende = "aguardando" | "recusado";

/**
 * Barra errata de valores (orçado, planejado ou tipo) e remoção de linha
 * com SAVE — gerado, consumido, com pedido aguardando ou recusado ainda
 * não retirado (decisão 099, §15, 22/09/2026).
 *
 * A linha em save tem o planejado zerado e o crédito preso ao valor que o
 * financeiro aprovou; a que consome tem o faturamento amarrado à origem.
 * Corrigir por baixo disso mudaria um número que o financeiro aprovou (ou
 * está aprovando) sem ele saber. O caminho é tirar o save antes, pelo
 * pop-up da coluna Save. O banco recusa o mesmo depois do deploy
 * (`save_trava_linha_job`), mas a recusa tem de vir ANTES de a errata ser
 * gravada: lá embaixo ela seria errata fantasma no histórico.
 *
 * Por item, com o nome dele na mensagem, como as outras travas daqui.
 * Retorna a mensagem de bloqueio, ou null quando a errata pode seguir.
 */
function barrarLinhaComSave(
  ids: string[],
  porId: Map<string, any>,
  pedidos: Map<string, PedidoQuePrende>,
  acao: "errata" | "cancelamento",
): string | null {
  for (const id of ids) {
    const linha = porId.get(id);
    if (!linha) continue;
    const pedido = pedidos.get(id);
    let motivo: string | null = null;
    let saida = "";
    if (pedido === "aguardando") {
      motivo = "tem pedido de save aguardando aprovação do financeiro";
      saida = "cancele o pedido pelo pop-up da coluna Save";
    } else if (pedido === "recusado") {
      motivo = "teve o save recusado pelo financeiro, e a recusa ainda não foi retirada";
      saida = "retire o save recusado pelo pop-up da coluna Save";
    } else if (linha.em_save === true) {
      motivo = "está marcada como save";
      saida = "retire o save pelo pop-up da coluna Save";
    } else if (Number(linha.save_consumido ?? 0) > 0) {
      motivo = "é paga com saldo de save de outro job";
      saida = "retire o consumo de save pelo pop-up da coluna Save";
    }
    if (!motivo) continue;
    return acao === "errata"
      ? `"${linha.item}" ${motivo}. Linha com save não entra em errata — para corrigi-la, ${saida} antes.`
      : `"${linha.item}" ${motivo}. Linha com save não pode ser cancelada — ${saida} antes.`;
  }
  return null;
}

/** O PLANEJADO da linha, opcional nos dois schemas. Desde a decisão 151
 *  (07/10/2026) o servidor IGNORA o que vier aqui: a errata não muda o
 *  planejado (`planejadoDaErrata`). Fica no schema para o payload de uma
 *  aba aberta antes da mudança continuar válido. */
const planejadoSchema = {
  valor_unitario_planejado: z.number().nonnegative().optional(),
  quantidade_planejada: z.number().nonnegative().optional(),
  dias_meses_planejado: z.number().nonnegative().optional(),
};

const alteracaoSchema = z.object({
  job_item_orcado_id: z.string().uuid(),
  valor_unitario: z.number().nonnegative(),
  quantidade: z.number().nonnegative(),
  dias_meses: z.number().nonnegative(),
  tipo_custo: z.enum(TIPOS),
  ...planejadoSchema,
});

const novaSchema = z.object({
  grupo_id: z.string().uuid(),
  item: z
    .string()
    .trim()
    .min(1, "Toda linha nova precisa de uma descrição.")
    .max(200, "A descrição do item passa de 200 caracteres."),
  tipo_custo: z.enum(TIPOS),
  /** Linha vermelha: orçado e planejado zerados, só recebe PP. */
  linha_vermelha: z.boolean(),
  valor_unitario: z.number().nonnegative(),
  quantidade: z.number().nonnegative(),
  dias_meses: z.number().nonnegative(),
  ...planejadoSchema,
});

/** O que a errata decide, sem a descrição. É também o que a errata pronta
 *  para envio guarda (decisão 159). */
const conteudoSchema = z.object({
  alteracoes: z.array(alteracaoSchema).default([]),
  novas: z.array(novaSchema).default([]),
  /** Linhas que a errata CANCELA (decisão 151): ficam com o orçado zerado
   *  e o planejado da abertura. */
  cancelamentos: z.array(z.string().uuid()).default([]),
  /** O nome antigo, de uma aba aberta antes da decisão 151. Vale como
   *  cancelamento: a errata não apaga mais linha. */
  remocoes: z.array(z.string().uuid()).default([]),
});

const payloadSchema = conteudoSchema.extend({
  // A "Descrição da errata" do pop-up. Grava em `titulo`, que é a coluna
  // que o card do histórico e o fio da Comunicação já leem. O teto subiu
  // de 200 para 500 em 27/08/2026, quando o campo deixou de ser um título
  // curto e passou a ser a explicação inteira.
  descricao: z
    .string()
    .trim()
    .min(5, "A descrição da errata precisa de pelo menos 5 caracteres.")
    .max(500, "A descrição da errata passa de 500 caracteres."),
  /** A errata pronta para envio que este envio consome (decisão 159). A
   *  função do banco a dá por enviada na mesma transação. */
  errataProntaId: z.string().uuid().nullable().optional(),
});

/** A errata pronta para envio (decisão 159): o mesmo conteúdo, com a
 *  descrição opcional. */
const prontaSchema = conteudoSchema.extend({
  errataProntaId: z.string().uuid().nullable(),
  descricao: z
    .string()
    .trim()
    .max(500, "A descrição da errata passa de 500 caracteres.")
    .nullable()
    .transform((d) => (d === null || d === "" ? null : d)),
});

export type AlteracaoErrata = z.infer<typeof alteracaoSchema>;
export type NovaLinhaErrata = z.infer<typeof novaSchema>;
export type PayloadErrata = z.input<typeof payloadSchema>;
export type PayloadErrataPronta = z.input<typeof prontaSchema>;
type ConteudoValidado = z.output<typeof conteudoSchema>;

/** Valor monetário gravado sempre com 2 casas, como `jobs.valor_total`. */
function dinheiro(n: number): number {
  return Number(n.toFixed(2));
}

/** O que uma linha vale, pela mesma conta da coluna gerada do banco. */
function totalDe(unit: number, qtd: number, dm: number): number {
  return unit * qtd * dm;
}

interface Mudanca {
  acao: ErrataAcao;
  /** `null` só na linha nova, que ainda não tem id. */
  copiaId: string | null;
  itemNome: string;
  grupoId: string | null;
  grupoNome: string;
  linhaVermelha: boolean;
  tipoDe: TipoCusto;
  tipoPara: TipoCusto;
  unitarioDe: number;
  unitarioPara: number;
  qtdDe: number;
  qtdPara: number;
  dmDe: number;
  dmPara: number;
  totalDe: number;
  totalPara: number;
  /** O PLANEJADO da linha, antes e depois. Iguais desde a decisão 151,
   *  menos na linha nova (zero) e no Interno (acompanha o orçado). */
  planUnitDe: number;
  planUnitPara: number;
  planQtdDe: number;
  planQtdPara: number;
  planDmDe: number;
  planDmPara: number;
  planTotalDe: number;
  planTotalPara: number;
  efeito: { faturamentoPrevisto: number; valorJob: number };
}

interface Trio {
  unit: number;
  qtd: number;
  dm: number;
}

/**
 * O planejado que a linha tem depois da errata (decisão 151, 07/10/2026):
 * a errata NÃO muda o planejado, que é o da abertura do job. O servidor
 * decide sozinho, sem ler o que veio no payload, para uma chamada montada
 * à mão não gravar o que a tela não deixa:
 *
 * - linha vermelha ou em save: zero (o banco cobra os dois);
 * - serviço Interno: igual ao orçado novo (decisão 105 — o trigger
 *   `planejado_espelha_orcado` grava isso de todo jeito; aqui é para o
 *   histórico da errata contar o mesmo);
 * - linha nova: zero, com QT e D/M em 1, como ela nasce na tela;
 * - linha que já existia: o planejado que ela já tinha.
 */
function planejadoDaErrata(
  linha: { vermelha: boolean; emSave: boolean; interno: boolean; nova: boolean },
  orcadoPara: Trio,
  planejadoAtual: Trio,
): Trio {
  if (linha.vermelha || linha.emSave) return { unit: 0, qtd: 0, dm: 0 };
  if (linha.interno) return orcadoPara;
  if (linha.nova) return { unit: 0, qtd: 1, dm: 1 };
  return planejadoAtual;
}

/**
 * Registra uma errata e aplica o que ela decidiu no orçado do job.
 *
 * Desde 27/08/2026 a errata faz três coisas, e não uma:
 *
 * - **corrige** uma linha: R$ unitário, QT, D/M e tipo de custo. QT e D/M
 *   entraram junto com o modo errata na própria planilha — antes eles
 *   ficavam congelados como aprovados. O PLANEJADO não muda desde a
 *   decisão 151 (07/10/2026): ele é o da abertura (`planejadoDaErrata`).
 * - **cria** linha, normal ou VERMELHA. A normal entra com o planejado
 *   zerado; a vermelha nasce zerada no orçado e no planejado e serve só
 *   para receber PP: é o custo que o orçamento não previu e que alguém
 *   precisa pedir mesmo assim.
 * - **cancela** linha (decisão 151; até ali, removia), desde que ela ainda
 *   não tenha documento nem save. A cancelada fica na planilha com o orçado
 *   zerado e o planejado da abertura.
 *
 * Desde 22/09/2026 (decisão 099) linha com save — gerado, consumido, com
 * pedido aguardando ou recusado ainda não retirado — não entra em errata
 * nem é cancelada (`barrarLinhaComSave`), e os números gravados (espelhos
 * do job e antes → depois da errata) são os do FINANCEIRO: pedido de save
 * que ainda aguarda fica de fora (`totaisDoFinanceiro`).
 *
 * E devolve o job ao mural de abertura: os números que o financeiro usou
 * para montar previsão de recebimento, curva de desembolso e competência
 * acabaram de mudar. O status do job NÃO muda — ele segue aberto e a
 * produção segue trabalhando; o que trava é o envio para faturamento.
 *
 * Grava a errata antes de aplicar: ela guarda a fotografia de custo e
 * faturamento dos dois lados, mais o efeito de cada linha. Isso mantém o
 * histórico legível mesmo que as regras de honorários ou imposto mudem.
 *
 * Desde a decisão 159 (08/10/2026) registrar é do GP e do administrador —
 * é o que manda a errata ao financeiro. O produtor deixa a errata PRONTA
 * PARA ENVIO (`salvarErrataPronta`), e o GP a envia por aqui, com
 * `errataProntaId`. As travas e a conta moram em `montarErrata`, que as
 * duas actions usam.
 */
export async function registrarErrata(
  jobId: string,
  payload: PayloadErrata,
): Promise<Result> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.criar_errata");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }
  const { descricao } = parsed.data;
  const errataProntaId = parsed.data.errataProntaId ?? null;

  const montada = await montarErrata(
    session,
    jobId,
    parsed.data,
    descricao,
    "job.errata_registrada",
  );
  if (!montada.ok) return montada;
  const { mudancas, antes, depois, perderamBv, devolveAoMural } = montada;

  const { data: gravada, error: gravarErr } = await supabase.rpc(
    "registrar_errata_do_job",
    {
      p_job_id: jobId,
      // A errata pronta que este envio consome (decisão 159): a função a dá
      // por enviada na mesma transação, e recusa errata nova enquanto o job
      // tiver uma pronta parada.
      p: { ...montada.p, errata_pronta_id: errataProntaId },
    },
  );

  if (gravarErr || !gravada) {
    console.error("[errata.gravar]", gravarErr?.message);
    // P0001 é mensagem nossa, escrita para a tela (as travas do banco).
    const doBanco =
      gravarErr?.code === "P0001" && gravarErr.message ? ` ${gravarErr.message}` : "";
    return {
      ok: false,
      message: `Não foi possível registrar a errata, e nada foi gravado.${doBanco}`,
    };
  }

  const resultado = gravada as {
    errata_id: string;
    bvs_cancelados: Array<{ id: string; valor: number; job_item_orcado_id: string }>;
  };
  const errata = { id: resultado.errata_id };

  for (const bv of resultado.bvs_cancelados ?? []) {
    const m = perderamBv.find((x) => x.copiaId === bv.job_item_orcado_id);
    await logAuditEvent({
      acao: "item_bv.cancelado",
      tenantId: session.activeTenant.id,
      entidadeTipo: "item_bv",
      entidadeId: bv.id,
      metadata: {
        job_item_orcado_id: bv.job_item_orcado_id,
        item: m?.itemNome ?? null,
        valor: bv.valor,
        motivo: "errata_mudou_tipo_de_custo",
        errata_id: errata.id,
        tipo_de: m?.tipoDe ?? null,
        tipo_para: m?.tipoPara ?? null,
      },
    });
  }

  const contar = (a: ErrataAcao) =>
    mudancas.filter((m) => m.acao === a).length;

  await logAuditEvent({
    acao: "job.errata_registrada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      errata_id: errata.id,
      descricao,
      // Decisão 159: a errata veio da pronta para envio.
      errata_pronta_id: errataProntaId,
      itens_alterados: contar("alterada"),
      itens_novos: contar("nova"),
      itens_cancelados: contar("cancelada"),
      linhas_vermelhas: mudancas.filter(
        (m) => m.acao === "nova" && m.linhaVermelha,
      ).length,
      devolveu_ao_mural: devolveAoMural,
      valor_job_antes: antes.valorJob,
      valor_job_depois: depois.valorJob,
      faturamento_previsto_antes: antes.faturamentoPrevisto,
      faturamento_previsto_depois: depois.faturamentoPrevisto,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/financeiro/jobs/${jobId}`);
  revalidatePath("/financeiro/abertura-de-job");
  return { ok: true, errataId: errata.id };
}

/**
 * Deixa a errata PRONTA PARA ENVIO (decisão 159, 08/10/2026), ou atualiza
 * a que o job já tem.
 *
 * O produtor faz a errata, mas quem a envia ao financeiro é um GP. A pronta
 * passa pelas MESMAS travas da errata (`montarErrata`: job aberto, mês já
 * enviado, PP no financeiro, save, BV…) — o produtor fica sabendo na hora
 * que uma linha não entra, e não só quando o GP tentar enviar. No envio
 * tudo é conferido de novo, com o job de então.
 *
 * Nada no job muda aqui: o orçado, o faturamento previsto e o mural do
 * financeiro seguem como estavam. Uma pronta por job — o banco garante
 * pelo índice único.
 */
export async function salvarErrataPronta(
  jobId: string,
  payload: PayloadErrataPronta,
): Promise<{ ok: true; errataProntaId: string } | Err> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.preparar_errata");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const parsed = prontaSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }
  const { descricao, errataProntaId } = parsed.data;

  const montada = await montarErrata(
    session,
    jobId,
    parsed.data,
    descricao ?? "",
    "job.errata_pronta_salva",
  );
  if (!montada.ok) return montada;
  const { antes, depois, mudancas } = montada;

  const conteudo = {
    alteracoes: parsed.data.alteracoes,
    novas: parsed.data.novas,
    cancelamentos: Array.from(
      new Set([...parsed.data.cancelamentos, ...parsed.data.remocoes]),
    ),
  };
  const numeros = {
    conteudo,
    descricao,
    resumo: resumoDasMudancas(mudancas),
    custo_orcado_antes: dinheiro(antes.subtotalGeral),
    custo_orcado_depois: dinheiro(depois.subtotalGeral),
    valor_job_antes: dinheiro(antes.valorJob),
    valor_job_depois: dinheiro(depois.valorJob),
    faturamento_previsto_antes: dinheiro(antes.faturamentoPrevisto),
    faturamento_previsto_depois: dinheiro(depois.faturamentoPrevisto),
    // Quem gravou por último passa a ser quem preparou.
    preparada_por: session.profile.id,
    preparada_em: new Date().toISOString(),
  };

  let id: string;
  if (errataProntaId) {
    const { data, error } = await supabase
      .from("jobs_erratas_prontas")
      .update(numeros)
      .eq("id", errataProntaId)
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id)
      .eq("situacao", "pronta")
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[errata_pronta.atualizar]", error.message);
      return { ok: false, message: "Não foi possível salvar a errata pronta. Tente de novo." };
    }
    if (!data) {
      return {
        ok: false,
        message:
          "Esta errata pronta já foi enviada ao financeiro ou descartada. Recarregue a página para ver como o job ficou.",
      };
    }
    id = data.id as string;
  } else {
    const { data, error } = await supabase
      .from("jobs_erratas_prontas")
      .insert({
        ...numeros,
        tenant_id: session.activeTenant.id,
        job_id: jobId,
        created_by: session.profile.id,
      })
      .select("id")
      .single();
    if (error || !data) {
      // 23505: o índice de uma pronta por job — outra pessoa deixou uma
      // pronta enquanto esta tela estava aberta.
      if (error?.code === "23505") {
        return {
          ok: false,
          message:
            "Este job já tem uma errata pronta para envio, feita por outra pessoa enquanto você editava. Recarregue a página e continue dela.",
        };
      }
      console.error("[errata_pronta.criar]", error?.message);
      return { ok: false, message: "Não foi possível salvar a errata pronta. Tente de novo." };
    }
    id = data.id as string;
  }

  await logAuditEvent({
    acao: "job.errata_pronta_salva",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      errata_pronta_id: id,
      atualizou: errataProntaId !== null,
      descricao,
      resumo: numeros.resumo,
      valor_job_antes: numeros.valor_job_antes,
      valor_job_depois: numeros.valor_job_depois,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, errataProntaId: id };
}

/**
 * Descarta a errata pronta para envio (decisão 159): qualquer produtor, GP
 * ou administrador. A linha fica no banco como `descartada`, com quem e
 * quando — nada é apagado. Nada foi ao financeiro, então nada mais muda.
 */
export async function descartarErrataPronta(
  jobId: string,
  errataProntaId: string,
): Promise<{ ok: true } | Err> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.preparar_errata");
  if (!gate.ok) return gate;
  const supabase = createClient();

  if (!z.string().uuid().safeParse(errataProntaId).success) {
    return { ok: false, message: "Errata pronta inválida." };
  }

  const { data, error } = await supabase
    .from("jobs_erratas_prontas")
    .update({
      situacao: "descartada",
      descartada_por: session.profile.id,
      descartada_em: new Date().toISOString(),
    })
    .eq("id", errataProntaId)
    .eq("job_id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .eq("situacao", "pronta")
    .select("id, resumo, descricao")
    .maybeSingle();
  if (error) {
    console.error("[errata_pronta.descartar]", error.message);
    return { ok: false, message: "Não foi possível descartar a errata pronta. Tente de novo." };
  }
  if (!data) {
    return {
      ok: false,
      message:
        "Esta errata pronta já foi enviada ao financeiro ou descartada. Recarregue a página para ver como o job ficou.",
    };
  }

  await logAuditEvent({
    acao: "job.errata_pronta_descartada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      errata_pronta_id: errataProntaId,
      resumo: (data as { resumo: string }).resumo,
      descricao: (data as { descricao: string | null }).descricao,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** "2 linhas alteradas · 1 linha nova" — o mesmo texto do rascunho da tela. */
function resumoDasMudancas(mudancas: Mudanca[]): string {
  const conta = (a: ErrataAcao) => mudancas.filter((m) => m.acao === a).length;
  const partes: string[] = [];
  const alt = conta("alterada");
  const nov = conta("nova");
  const can = conta("cancelada");
  if (alt) partes.push(`${alt} ${alt === 1 ? "linha alterada" : "linhas alteradas"}`);
  if (nov) partes.push(`${nov} ${nov === 1 ? "linha nova" : "linhas novas"}`);
  if (can) partes.push(`${can} ${can === 1 ? "linha cancelada" : "linhas canceladas"}`);
  return partes.join(" · ");
}

type Sessao = Awaited<ReturnType<typeof requireSession>>;

interface ErrataMontada {
  ok: true;
  /** O `p` de `registrar_errata_do_job`, sem a errata pronta. */
  p: Record<string, unknown>;
  mudancas: Mudanca[];
  antes: ReturnType<typeof totaisDoFinanceiro>;
  depois: ReturnType<typeof totaisDoFinanceiro>;
  perderamBv: Mudanca[];
  devolveAoMural: boolean;
}

/**
 * Confere e monta a errata, sem gravar nada (decisão 159): todas as travas
 * e a conta de antes e depois que `registrarErrata` fazia antes de chamar o
 * banco. A errata pronta para envio passa pelo mesmo caminho, para o
 * produtor saber na hora que uma linha não entra.
 *
 * `acaoTentada` é o que a auditoria de `acao_negada` registra quando o job
 * não aceita errata.
 */
async function montarErrata(
  session: Sessao,
  jobId: string,
  conteudo: ConteudoValidado,
  descricao: string,
  acaoTentada: "job.errata_registrada" | "job.errata_pronta_salva",
): Promise<ErrataMontada | Err> {
  const supabase = createClient();
  const { alteracoes, novas } = conteudo;
  // `remocoes` é de aba aberta antes da decisão 151: vale como cancelamento.
  const cancelamentos = Array.from(
    new Set([...conteudo.cancelamentos, ...conteudo.remocoes]),
  );

  if (alteracoes.length + novas.length + cancelamentos.length === 0) {
    return { ok: false, message: "Nenhuma alteração informada." };
  }

  // ---- Gate: job existe, do tenant, e em status editável ----
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select(
      "id, tenant_id, status, versao_orcamento_aprovada_id, projeto_id, orcamento_id, data_abertura_financeiro, abertura_em_revisao",
    )
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (jobErr || !job) return { ok: false, message: "Job não encontrado." };

  // Errata continua exigindo o job ABERTO, mesmo agora que a planilha
  // aparece na pré-abertura (17/08/2026): mexer no orçado antes de o
  // financeiro conferir o job é justamente o que a abertura protege.
  if (!jobAceitaAcoesPlanilha(job.status as JobStatus)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        acao_tentada: acaoTentada,
        motivo: "status_bloqueia_edicao",
        status_atual: job.status,
      },
    });
    return {
      ok: false,
      message:
        "O orçado só pode ser alterado com o job em 'Aberto' ou 'Em produção'.",
    };
  }

  // Permissão por papel fica liberada nesta fase, por decisão do time
  // (04/08/2026). O gate de status acima continua valendo pra todo mundo.

  // ---- Percentuais vêm da versão aprovada, que não muda por errata ----
  const { data: versao, error: versaoErr } = await supabase
    .from("versoes_orcamento")
    // Os quatro últimos são da cadeia internacional (decisão 072): a
    // errata GRAVA faturamento e valor do job, então errar aqui é erro no
    // banco, não na tela.
    //
    // ⚠️ O embed do orçamento PRECISA da dica `!orcamento_id`: há duas FKs
    // entre `versoes_orcamento` e `orcamentos` (a `orcamento_id` e a
    // `orcamentos.versao_aprovada_id`). Sem a dica o PostgREST recusa a
    // consulta por ambiguidade, e toda errata saía com "Versão aprovada do
    // job não encontrada" — de 11/09 a 14/09/2026.
    .select(
      // O serviço vem junto para saber se o job é Interno (decisão 105):
      // ali o planejado acompanha o orçado. Dica `!servico_id` obrigatória
      // — `orcamentos` tem duas FKs para `categorias_dominio`.
      "id, percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs, moeda_estrangeira, cambio_compra, orcamento:orcamentos!orcamento_id(categoria:categorias_dominio!categoria_id(modelo_planilha), servico:categorias_dominio!servico_id(investimento_interno))",
    )
    .eq("id", job.versao_orcamento_aprovada_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (versaoErr || !versao) {
    return { ok: false, message: "Versão aprovada do job não encontrada." };
  }

  const pctHonorarios = Number(versao.percentual_honorarios ?? 0);
  const pctImposto = Number(versao.percentual_imposto ?? 0);
  // Quem decide a cadeia é a categoria do ORÇAMENTO (decisão 072).
  const planilha = configDaPlanilha(
    (versao as { orcamento?: { categoria?: { modelo_planilha?: string } } })
      .orcamento?.categoria?.modelo_planilha as
      | CategoriaModeloPlanilha
      | undefined,
    versao as never,
  );
  // Serviço Interno (decisão 105): o planejado acompanha o orçado.
  const interno =
    (versao as { orcamento?: { servico?: { investimento_interno?: boolean } | null } })
      .orcamento?.servico?.investimento_interno === true;

  // Depois do envio o valor da nota está congelado: mexer no orçado agora
  // faria a nota sair por um número que não é mais o do job (27/08/2026).
  // No modelo mensal (decisão 078) a porta fecha por MÊS — a conferência
  // fica mais abaixo, quando os grupos das linhas já estão lidos.
  const mensal = planilha.modeloPlanilha === "mensal";
  if (
    !mensal &&
    (await jobJaEnviadoParaFaturamento(supabase, jobId, session.activeTenant.id))
  ) {
    return { ok: false, message: MENSAGEM_JA_ENVIADO };
  }

  // ---- Estado atual do orçado do job ----
  // Três leituras independentes: as linhas com tudo que a errata mexe, a
  // base dos espelhos (os números do financeiro, decisão 099) e os pedidos
  // de save que prendem linha — aguardando, ou recusado não retirado.
  const [itensRes, baseRes, pedidosRes] = await Promise.all([
    supabase
      .from("jobs_itens_orcado")
      .select(
        "id, item_versao_id, item, grupo_id, ordem, tipo_custo, linha_vermelha, " +
          "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, total_orcado, " +
          "valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, total_planejado, " +
          "em_save, save_consumido, cancelada_em",
      )
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id),
    lerBaseDosEspelhos(supabase, session.activeTenant.id, jobId),
    supabase
      .from("saves_aprovacoes")
      .select("job_item_orcado_id, situacao")
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id)
      .in("situacao", ["aguardando", "recusado"]),
  ]);
  const { data: itensAtuais, error: itensErr } = itensRes;

  if (itensErr || !itensAtuais) {
    return { ok: false, message: "Não foi possível ler o orçado do job." };
  }
  if (!baseRes.ok) return { ok: false, message: baseRes.message };
  const base = baseRes.base;
  if (pedidosRes.error) {
    // Sem saber quais linhas têm pedido, a trava de save não teria como
    // valer: melhor parar do que deixar passar.
    console.error("[errata.pedidos_save]", pedidosRes.error.message);
    return { ok: false, message: "Não foi possível ler os pedidos de save do job." };
  }
  const pedidoQuePrende = new Map<string, PedidoQuePrende>();
  for (const p of (pedidosRes.data ?? []) as {
    job_item_orcado_id: string | null;
    situacao: PedidoQuePrende;
  }[]) {
    if (!p.job_item_orcado_id) continue;
    // O aguardando fala primeiro: é ele que a produção resolve cancelando.
    if (pedidoQuePrende.get(p.job_item_orcado_id) !== "aguardando") {
      pedidoQuePrende.set(p.job_item_orcado_id, p.situacao);
    }
  }

  const porId = new Map(itensAtuais.map((i: any) => [i.id as string, i]));

  // Nome do grupo entra congelado no histórico.
  const { data: grupos } = await supabase
    .from("versoes_orcamento_grupos")
    .select("id, nome, mes_id")
    .eq("versao_orcamento_id", job.versao_orcamento_aprovada_id)
    .eq("tenant_id", session.activeTenant.id);
  const nomeDoGrupo = new Map(
    (grupos ?? []).map((g: any) => [g.id as string, g.nome as string]),
  );

  // Modelo mensal (decisão 078): errata não toca linha de mês já enviado
  // para faturamento — nem corrige, nem remove, nem cria linha nova num
  // grupo desse mês. Os outros meses seguem editáveis.
  if (mensal) {
    let enviados: Set<string>;
    try {
      enviados = await mesesEnviadosDoJob(supabase, jobId, session.activeTenant.id);
    } catch {
      return {
        ok: false,
        message: "Não foi possível conferir os meses enviados para faturamento. Tente de novo.",
      };
    }
    if (enviados.size > 0) {
      const { data: mesesDaVersao } = await supabase
        .from("versoes_orcamento_meses")
        .select("id, mes")
        .eq("versao_orcamento_id", job.versao_orcamento_aprovada_id)
        .eq("tenant_id", session.activeTenant.id);
      const mesDoId = new Map(
        (mesesDaVersao ?? []).map((m: any) => [m.id as string, m.mes as string]),
      );
      const mesDoGrupo = new Map(
        (grupos ?? []).map((g: any) => [
          g.id as string,
          g.mes_id ? (mesDoId.get(g.mes_id) ?? null) : null,
        ]),
      );
      const tocados = new Set<string>();
      const conferir = (grupoId: string | undefined) => {
        const mes = grupoId ? mesDoGrupo.get(grupoId) : null;
        if (mes && enviados.has(mes)) tocados.add(mes);
      };
      for (const alt of alteracoes) conferir(porId.get(alt.job_item_orcado_id)?.grupo_id);
      for (const id of cancelamentos) conferir(porId.get(id)?.grupo_id);
      for (const nova of novas) conferir(nova.grupo_id);
      if (tocados.size > 0) {
        return {
          ok: false,
          message: mensagemMesJaEnviado([...tocados].sort().map(nomeDoMes)),
        };
      }
    }
  }

  const efeitoDe = (
    de: { total: number; tipoCusto: TipoCusto },
    para: { total: number; tipoCusto: TipoCusto },
  ) =>
    calcularEfeitoDaMudanca(
      de,
      para,
      pctHonorarios,
      pctImposto,
      planilha.internacional,
    );

  const mudancas: Mudanca[] = [];

  // ---- 1. Correções em linha que já existe ----
  for (const alt of alteracoes) {
    const atual = porId.get(alt.job_item_orcado_id);
    if (!atual) {
      return {
        ok: false,
        message: "Um dos itens alterados não pertence a este job.",
      };
    }

    // Linha cancelada (decisão 151) não se corrige: o banco recusaria, e a
    // mensagem dele não diria qual linha.
    if (atual.cancelada_em) {
      return {
        ok: false,
        message: `"${atual.item}" foi cancelada numa errata anterior e não pode ser corrigida.`,
      };
    }

    // A linha vermelha não tem orçado para corrigir — o banco recusaria
    // (`chk_jio_linha_vermelha_zerada`), e a mensagem dele não ajudaria.
    if (atual.linha_vermelha === true && alt.valor_unitario !== 0) {
      return {
        ok: false,
        message: `"${atual.item}" é uma linha vermelha: ela não tem orçado, só recebe realizado por Pedido de Produção.`,
      };
    }

    const unitarioDe = Number(atual.valor_unitario_orcado ?? 0);
    const qtdDe = Number(atual.quantidade_orcada ?? 1);
    const dmDe = Number(atual.dias_meses_orcado ?? 1);
    const tipoDe = atual.tipo_custo as TipoCusto;

    const orcadoMudou =
      alt.valor_unitario !== unitarioDe ||
      alt.quantidade !== qtdDe ||
      alt.dias_meses !== dmDe;
    const mudou = orcadoMudou || alt.tipo_custo !== tipoDe;
    // Planejado não é errata (decisão 151): sem mudança no orçado ou no
    // tipo, a linha não entra.
    if (!mudou) continue;

    const totalAntes = Number(atual.total_orcado ?? 0);
    const totalDepois = totalDe(
      alt.valor_unitario,
      alt.quantidade,
      alt.dias_meses,
    );

    const planAtual: Trio = {
      unit: Number(atual.valor_unitario_planejado ?? 0),
      qtd: Number(atual.quantidade_planejada ?? 0),
      dm: Number(atual.dias_meses_planejado ?? 0),
    };
    const planPara = planejadoDaErrata(
      {
        vermelha: atual.linha_vermelha === true,
        emSave: atual.em_save === true,
        interno,
        nova: false,
      },
      { unit: alt.valor_unitario, qtd: alt.quantidade, dm: alt.dias_meses },
      planAtual,
    );

    mudancas.push({
      acao: "alterada",
      copiaId: atual.id,
      itemNome: atual.item,
      grupoId: atual.grupo_id,
      grupoNome: nomeDoGrupo.get(atual.grupo_id) ?? "—",
      linhaVermelha: atual.linha_vermelha === true,
      tipoDe,
      tipoPara: alt.tipo_custo,
      unitarioDe,
      unitarioPara: alt.valor_unitario,
      qtdDe,
      qtdPara: alt.quantidade,
      dmDe,
      dmPara: alt.dias_meses,
      totalDe: totalAntes,
      totalPara: totalDepois,
      planUnitDe: planAtual.unit,
      planUnitPara: planPara.unit,
      planQtdDe: planAtual.qtd,
      planQtdPara: planPara.qtd,
      planDmDe: planAtual.dm,
      planDmPara: planPara.dm,
      planTotalDe: Number(atual.total_planejado ?? 0),
      planTotalPara: totalDe(planPara.unit, planPara.qtd, planPara.dm),
      // Os DOIS efeitos: mudar o tipo pode mexer num sem mexer no outro
      // (A · Direto -> A · Repasse move só o faturamento previsto).
      efeito: efeitoDe(
        { total: totalAntes, tipoCusto: tipoDe },
        { total: totalDepois, tipoCusto: alt.tipo_custo },
      ),
    });
  }

  // ---- 2. Cancelamentos (decisão 151) ----
  // A linha fica na planilha com o orçado zerado e o planejado da abertura.
  // As travas são as que a remoção tinha — PP no histórico, BV lançado e
  // save —, com nome de gente na mensagem.
  if (cancelamentos.length > 0) {
    const bloqueio = await barrarCancelamento(
      jobId,
      session.activeTenant.id,
      cancelamentos,
      porId,
      pedidoQuePrende,
    );
    if (bloqueio) return { ok: false, message: bloqueio };

    for (const id of cancelamentos) {
      const atual = porId.get(id);
      if (!atual) {
        return {
          ok: false,
          message: "Uma das linhas canceladas não pertence a este job.",
        };
      }
      if (atual.cancelada_em) {
        return {
          ok: false,
          message: `"${atual.item}" já foi cancelada numa errata anterior.`,
        };
      }
      const tipo = atual.tipo_custo as TipoCusto;
      const totalAntes = Number(atual.total_orcado ?? 0);
      const planUnit = Number(atual.valor_unitario_planejado ?? 0);
      const planQtd = Number(atual.quantidade_planejada ?? 0);
      const planDm = Number(atual.dias_meses_planejado ?? 0);
      const planTotal = Number(atual.total_planejado ?? 0);
      const qtd = Number(atual.quantidade_orcada ?? 1);
      const dm = Number(atual.dias_meses_orcado ?? 1);

      mudancas.push({
        acao: "cancelada",
        copiaId: atual.id,
        itemNome: atual.item,
        grupoId: atual.grupo_id,
        grupoNome: nomeDoGrupo.get(atual.grupo_id) ?? "—",
        linhaVermelha: atual.linha_vermelha === true,
        tipoDe: tipo,
        tipoPara: tipo,
        // O unitário vai a zero; QT e D/M ficam como estavam.
        unitarioDe: Number(atual.valor_unitario_orcado ?? 0),
        unitarioPara: 0,
        qtdDe: qtd,
        qtdPara: qtd,
        dmDe: dm,
        dmPara: dm,
        totalDe: totalAntes,
        totalPara: 0,
        // O planejado fica: é o da abertura (no Interno, o trigger o leva
        // a zero junto com o orçado).
        planUnitDe: planUnit,
        planUnitPara: interno ? 0 : planUnit,
        planQtdDe: planQtd,
        planQtdPara: planQtd,
        planDmDe: planDm,
        planDmPara: planDm,
        planTotalDe: planTotal,
        planTotalPara: interno ? 0 : planTotal,
        efeito: efeitoDe(
          { total: totalAntes, tipoCusto: tipo },
          { total: 0, tipoCusto: tipo },
        ),
      });
    }
  }

  // ---- 3. Linhas novas ----
  for (const nova of novas) {
    if (!nomeDoGrupo.has(nova.grupo_id)) {
      return {
        ok: false,
        message: "Uma das linhas novas aponta para um grupo que não é deste orçamento.",
      };
    }

    // A vermelha é zerada por definição, e o banco cobra isso. Zerar aqui
    // evita que um payload adulterado passe um orçado pela porta dos
    // fundos e leve um erro cru de constraint para a tela.
    const unit = nova.linha_vermelha ? 0 : nova.valor_unitario;
    const qtd = nova.linha_vermelha ? 1 : nova.quantidade;
    const dm = nova.linha_vermelha ? 1 : nova.dias_meses;
    const total = totalDe(unit, qtd, dm);
    // A linha nova entra com o planejado zerado (decisão 151).
    const plan = planejadoDaErrata(
      { vermelha: nova.linha_vermelha, emSave: false, interno, nova: true },
      { unit, qtd, dm },
      { unit: 0, qtd: 0, dm: 0 },
    );

    mudancas.push({
      acao: "nova",
      copiaId: null,
      itemNome: nova.item,
      grupoId: nova.grupo_id,
      grupoNome: nomeDoGrupo.get(nova.grupo_id) ?? "—",
      linhaVermelha: nova.linha_vermelha,
      tipoDe: nova.tipo_custo,
      tipoPara: nova.tipo_custo,
      unitarioDe: 0,
      unitarioPara: unit,
      qtdDe: 0,
      qtdPara: qtd,
      dmDe: 0,
      dmPara: dm,
      totalDe: 0,
      totalPara: total,
      planUnitDe: 0,
      planUnitPara: plan.unit,
      planQtdDe: 0,
      planQtdPara: plan.qtd,
      planDmDe: 0,
      planDmPara: plan.dm,
      planTotalDe: 0,
      planTotalPara: totalDe(plan.unit, plan.qtd, plan.dm),
      efeito: efeitoDe(
        { total: 0, tipoCusto: nova.tipo_custo },
        { total, tipoCusto: nova.tipo_custo },
      ),
    });
  }

  if (mudancas.length === 0) {
    return { ok: false, message: "Nenhum valor foi alterado." };
  }

  // ---- Trava de linha com save (decisão 099, §15) ----
  // Antes de qualquer gravação: a errata é o primeiro insert lá embaixo.
  const alteradas = mudancas.filter((m) => m.acao === "alterada");
  if (alteradas.length > 0) {
    const bloqueioSave = barrarLinhaComSave(
      alteradas.map((m) => m.copiaId ?? ""),
      porId,
      pedidoQuePrende,
      "errata",
    );
    if (bloqueioSave) return { ok: false, message: bloqueioSave };
  }

  // ---- Trava de linha com PP no financeiro (decisão 040) ----
  // Qualquer correção — valor, QT, D/M ou tipo — em linha que já tem PP
  // emitida é recusada. O realizado dela já existe, e reescrever o orçado
  // por cima seria mudar a régua depois da medida.
  if (alteradas.length > 0) {
    const bloqueio = await barrarLinhaComPPNoFinanceiro(
      jobId,
      session.activeTenant.id,
      alteradas.map((m) => ({
        copiaId: m.copiaId ?? "",
        itemNome: m.itemNome,
      })),
    );
    if (bloqueio) return { ok: false, message: bloqueio };

    // ---- Trava do A · Repasse já concluído (decisão 062) ----
    const bloqueioAR = await barrarARConcluido(
      jobId,
      session.activeTenant.id,
      alteradas.map((m) => ({
        copiaId: m.copiaId ?? "",
        itemNome: m.itemNome,
      })),
    );
    if (bloqueioAR) return { ok: false, message: bloqueioAR };
  }

  // ---- Trava de troca de tipo: BV já confirmado ----
  // É a troca de tipo que faz BV e PP trocarem de lugar na calha, e ela
  // não pode passar por cima de dinheiro que já foi ao financeiro (o BV
  // confirmado). A PP ativa deixou de ser caso daqui: a trava acima cobre
  // a linha inteira.
  const trocasDeTipo = mudancas.filter(
    (m) => m.acao === "alterada" && m.tipoDe !== m.tipoPara,
  );
  if (trocasDeTipo.length > 0) {
    const bloqueio = await barrarTrocaDeTipo(
      jobId,
      session.activeTenant.id,
      trocasDeTipo.map((m) => ({
        copiaId: m.copiaId ?? "",
        itemNome: m.itemNome,
      })),
    );
    if (bloqueio) return { ok: false, message: bloqueio };
  }

  // ---- Totais antes e depois, como o FINANCEIRO vê (decisão 099) ----
  // Os mesmos números que vão para os espelhos do job (`jobs.valor_total`,
  // `faturamento_previsto`, `faturamento_save_previsto`) e para o
  // antes → depois da errata, que o financeiro lê na revisão da abertura.
  // Pedido de save que ainda aguarda fica de fora dos dois lados: ele só
  // entra nos números do financeiro na aprovação. Uma conta só para todo
  // escritor dos espelhos (`lib/data/espelhos-do-job.ts`).
  const antes = totaisDoFinanceiro(base.itens, base);

  const alteradasPorId = new Map(
    mudancas.filter((m) => m.acao === "alterada").map((m) => [m.copiaId, m]),
  );
  // A cancelada continua na conta, com o orçado zerado (decisão 151).
  const canceladasIds = new Set(
    mudancas.filter((m) => m.acao === "cancelada").map((m) => m.copiaId),
  );

  const depoisItens: LinhaDoEspelho[] = [
    ...base.itens
      .map((i) => {
        if (canceladasIds.has(i.id)) {
          return { ...i, total_orcado: 0, valor_unitario_orcado: 0 };
        }
        const m = alteradasPorId.get(i.id);
        return m
          ? {
              ...i,
              tipo_custo: m.tipoPara,
              total_orcado: m.totalPara,
              valor_unitario_orcado: m.unitarioPara,
            }
          : i;
      }),
    // A linha nova entra na conta do "depois" sem existir ainda no banco:
    // é ela que faz o pop-up mostrar o mesmo número que a planilha vai
    // mostrar depois de confirmar. O id provisório não casa com pedido
    // nenhum.
    ...mudancas
      .filter((m) => m.acao === "nova")
      .map((m, k) => ({
        id: `nova-${k}`,
        item: m.itemNome,
        grupo_id: m.grupoId,
        tipo_custo: m.tipoPara,
        total_orcado: m.totalPara,
        valor_unitario_orcado: m.unitarioPara,
        em_save: false,
        save_consumido: 0,
      })),
  ];
  const depois = totaisDoFinanceiro(depoisItens, base);
  const espelhos = espelhosDe(depois);

  // ---- O pacote de `registrar_errata_do_job` (24/09/2026) ----
  //
  // Montado aqui e gravado por `registrarErrata` (decisão 159: a errata
  // pronta passa pelas mesmas travas e não grava nada disto).
  //
  // `registrar_errata_do_job` faz as gravações que esta action fazia uma a
  // uma, na mesma ordem — a errata, as linhas novas com a âncora de
  // realizado, os itens da errata, as alteradas, as canceladas, o BV "a
  // negociar" que perdeu a razão de existir e, por fim, os números do job
  // com a revisão da abertura —, mas numa transação: ou tudo, ou nada.
  // Antes, uma falha no meio deixava o histórico dizendo que a linha mudou
  // sem ela ter mudado. A função roda como o usuário: valem as mesmas
  // policies e as travas de banco (save, linha vermelha…).
  //
  // A ordem das linhas novas continua sendo decidida aqui: a última do
  // grupo + 1, uma a uma.
  const ordemPorGrupo = new Map<string, number>();
  for (const i of itensAtuais as any[]) {
    const atual = ordemPorGrupo.get(i.grupo_id) ?? 0;
    ordemPorGrupo.set(i.grupo_id, Math.max(atual, Number(i.ordem ?? 0)));
  }
  const chaveDaNova = new Map<Mudanca, string>();
  const linhasNovas = mudancas
    .filter((x) => x.acao === "nova")
    .map((m, k) => {
      const grupoId = m.grupoId as string;
      const ordem = (ordemPorGrupo.get(grupoId) ?? 0) + 1;
      ordemPorGrupo.set(grupoId, ordem);
      const chave = `nova-${k}`;
      chaveDaNova.set(m, chave);
      return {
        chave,
        grupo_id: grupoId,
        ordem,
        item: m.itemNome,
        tipo_custo: m.tipoPara,
        // Sem contrapartida na versão: é o que define a linha de errata.
        linha_vermelha: m.linhaVermelha,
        valor_unitario_orcado: m.unitarioPara,
        quantidade_orcada: m.qtdPara,
        dias_meses_orcado: m.dmPara,
        // Zerado (decisão 151): o planejado do job é o da abertura. Na
        // vermelha o banco cobra o zero em `chk_jio_linha_vermelha_zerada`;
        // no Interno o trigger o iguala ao orçado.
        valor_unitario_planejado: m.planUnitPara,
        quantidade_planejada: m.planQtdPara,
        dias_meses_planejado: m.planDmPara,
      };
    });

  // Item que sai de A/D deixa de ter comissão a negociar: o BV "a
  // negociar" é cancelado junto — os travados já foram barrados lá em
  // cima. Ir de A para D não cancela: em D o cliente também paga o
  // fornecedor direto e o BV continua válido.
  const perderamBv = mudancas.filter(
    (m) =>
      m.acao === "alterada" && aceitaBV(m.tipoDe) && !aceitaBV(m.tipoPara),
  );

  // A errata devolve o job ao mural de abertura só quando o financeiro JÁ
  // abriu: numa errata anterior à abertura não há nada a revisar — o job
  // ainda está na fila de abertura normal. "Desde" é a PRIMEIRA errata
  // ainda não revisada (decisão do Tiago, 14/09/2026); a função cuida disso.
  const devolveAoMural = job.data_abertura_financeiro !== null;

  return {
    ok: true,
    p: {
      errata: {
        // A "Descrição da errata" do pop-up mora em `titulo`: é a coluna
        // que o histórico e o chat já liam.
        titulo: descricao,
        // Duas casas em tudo que é dinheiro: `jobs.valor_total` e
        // `valor_job_abertura` também são gravados assim, e sem isso o
        // card de Erratas mostra o mesmo delta com 1 centavo de diferença.
        custo_orcado_antes: dinheiro(antes.subtotalGeral),
        custo_orcado_depois: dinheiro(depois.subtotalGeral),
        valor_job_antes: dinheiro(antes.valorJob),
        valor_job_depois: dinheiro(depois.valorJob),
        faturamento_previsto_antes: dinheiro(antes.faturamentoPrevisto),
        faturamento_previsto_depois: dinheiro(depois.faturamentoPrevisto),
      },
      novas: linhasNovas,
      itens: mudancas.map((m) => ({
        // A linha nova ganha id dentro da função; o item da errata aponta
        // para ela pela chave. A cancelada continua existindo, então o
        // item aponta para ela como na correção.
        ...(m.acao === "nova"
          ? { chave_nova: chaveDaNova.get(m) }
          : { job_item_orcado_id: m.copiaId }),
        acao: m.acao,
        linha_vermelha: m.linhaVermelha,
        grupo_id: m.grupoId,
        item_nome: m.itemNome,
        grupo_nome: m.grupoNome,
        tipo_custo_de: m.tipoDe,
        tipo_custo_para: m.tipoPara,
        valor_unitario_de: m.unitarioDe,
        valor_unitario_para: m.unitarioPara,
        quantidade_de: m.qtdDe,
        quantidade_para: m.qtdPara,
        dias_meses_de: m.dmDe,
        dias_meses_para: m.dmPara,
        total_de: dinheiro(m.totalDe),
        total_para: dinheiro(m.totalPara),
        valor_unitario_planejado_de: m.planUnitDe,
        valor_unitario_planejado_para: m.planUnitPara,
        quantidade_planejada_de: m.planQtdDe,
        quantidade_planejada_para: m.planQtdPara,
        dias_meses_planejado_de: m.planDmDe,
        dias_meses_planejado_para: m.planDmPara,
        total_planejado_de: dinheiro(m.planTotalDe),
        total_planejado_para: dinheiro(m.planTotalPara),
        efeito_valor_job: dinheiro(m.efeito.valorJob),
        efeito_faturamento_previsto: dinheiro(m.efeito.faturamentoPrevisto),
      })),
      alteradas: mudancas
        .filter((m) => m.acao === "alterada")
        .map((m) => ({
          id: m.copiaId,
          tipo_custo: m.tipoPara,
          valor_unitario_orcado: m.unitarioPara,
          quantidade_orcada: m.qtdPara,
          dias_meses_orcado: m.dmPara,
          // O planejado que já estava lá (decisão 151): gravar o mesmo
          // número é inócuo, e o trigger tem a última palavra em save e
          // no Interno.
          valor_unitario_planejado: m.planUnitPara,
          quantidade_planejada: m.planQtdPara,
          dias_meses_planejado: m.planDmPara,
        })),
      // Decisão 151: a linha não sai mais — a função zera o unitário,
      // grava a marca de cancelada e dá as PPs dela por concluídas. As
      // situações travadas (PP, BV, save) foram barradas lá em cima.
      canceladas: mudancas
        .filter((m) => m.acao === "cancelada")
        .map((m) => m.copiaId),
      bv_cancelar: perderamBv.map((m) => m.copiaId),
      // `jobs.valor_total` é o Valor do Job; os dois números acompanham
      // o orçado e precisam andar juntos, senão a listagem mostra um par
      // que não fecha com a planilha do job.
      espelhos,
      devolve_ao_mural: devolveAoMural,
    },
    mudancas,
    antes,
    depois,
    perderamBv,
    devolveAoMural,
  };
}

/**
 * Barra o cancelamento de linha que já virou documento ou dinheiro.
 *
 * Até a decisão 151 (07/10/2026) a errata apagava a linha, e estas eram as
 * travas da remoção — as FKs discordavam entre si (`pedidos_compra` é
 * `on delete restrict`, `saves_consumos` é `on delete cascade`). O
 * cancelamento não apaga nada, mas herdou as mesmas travas de propósito:
 * a regra de quem pode sair da conta não mudou, só o jeito de sair.
 *
 * Retorna a mensagem de bloqueio, ou null quando o cancelamento pode seguir.
 */
async function barrarCancelamento(
  jobId: string,
  tenantId: string,
  copiaIds: string[],
  porId: Map<string, any>,
  pedidosDeSave: Map<string, PedidoQuePrende>,
): Promise<string | null> {
  const supabase = createClient();
  const nome = (id: string) => porId.get(id)?.item ?? "a linha";

  // 1. Save: é dinheiro do cliente, e o cascade o devolveria sem aviso.
  //    Desde a decisão 099 (22/09/2026) o pedido aguardando e o recusado
  //    ainda não retirado também prendem a linha: o pedido é histórico e
  //    ficaria apontando para uma linha que sumiu.
  const bloqueioSave = barrarLinhaComSave(copiaIds, porId, pedidosDeSave, "cancelamento");
  if (bloqueioSave) return bloqueioSave;

  const { data: realizados } = await supabase
    .from("jobs_itens_realizado")
    .select("id, job_item_orcado_id")
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .in("job_item_orcado_id", copiaIds);

  const copiaPorRealizado = new Map(
    (realizados ?? []).map((r: any) => [
      r.id as string,
      r.job_item_orcado_id as string,
    ]),
  );

  const [ppsRes, bvsRes] = await Promise.all([
    copiaPorRealizado.size > 0
      // Sem filtro de status: a PP cancelada também impede, porque a FK é
      // `on delete restrict` e o documento continua no histórico do
      // financeiro. Some a linha e a PP fica apontando para o nada.
      ? supabase
          .from("pedidos_compra")
          .select("codigo, status, item_realizado_id")
          .eq("job_id", jobId)
          .eq("tenant_id", tenantId)
          .in("item_realizado_id", Array.from(copiaPorRealizado.keys()))
      : Promise.resolve({ data: [] as any[], error: null }),
    supabase
      .from("itens_bv")
      .select("job_item_orcado_id, situacao")
      .eq("tenant_id", tenantId)
      .in("job_item_orcado_id", copiaIds)
      .neq("situacao", "cancelado"),
  ]);

  const pp = (ppsRes.data ?? [])[0] as
    | { codigo: string; status: string; item_realizado_id: string }
    | undefined;
  if (pp) {
    const copiaId = copiaPorRealizado.get(pp.item_realizado_id) ?? "";
    return `"${nome(copiaId)}" tem o Pedido de Produção ${pp.codigo} no histórico. Uma linha com PP não pode ser cancelada.`;
  }

  const bv = (bvsRes.data ?? [])[0] as
    | { job_item_orcado_id: string; situacao: string }
    | undefined;
  if (bv) {
    return `"${nome(bv.job_item_orcado_id)}" tem BV lançado. Cancele o BV antes de cancelar a linha.`;
  }

  return null;
}
