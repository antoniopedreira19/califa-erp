"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  MENSAGEM_JA_ENVIADO,
  jobJaEnviadoParaFaturamento,
} from "@/lib/data/envio-faturamento";
import {
  calcularTotaisVersao,
  calcularEfeitoDaMudanca,
  TIPOS_CUSTO,
  aceitaBV,
} from "@/lib/calculos/versao-totais";
import type { TipoCusto, JobStatus, ErrataAcao } from "@/lib/types";
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
 * Barra a troca de tipo de custo em item que já tem documento emitido.
 *
 * Por item, não pela errata inteira (decisão do time): quem está
 * corrigindo dez linhas não perde o trabalho por causa de uma. E só na
 * troca de TIPO — mudar valor, QT ou D/M com PP ativa segue permitido.
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

  const [ppsRes, bvsRes] = await Promise.all([
    copiaPorRealizado.size > 0
      ? supabase
          .from("pedidos_compra")
          .select("item_realizado_id, codigo")
          .eq("job_id", jobId)
          .eq("tenant_id", tenantId)
          .neq("status", "cancelada")
          .in("item_realizado_id", Array.from(copiaPorRealizado.keys()))
      : Promise.resolve({ data: [] as any[], error: null }),
    supabase
      .from("itens_bv")
      .select("job_item_orcado_id, situacao")
      .eq("tenant_id", tenantId)
      .in("job_item_orcado_id", copiaIds),
  ]);

  const pp = (ppsRes.data ?? [])[0] as
    | { item_realizado_id: string; codigo: string }
    | undefined;
  if (pp) {
    const copiaId = copiaPorRealizado.get(pp.item_realizado_id) ?? "";
    const nome = nomePorCopiaId.get(copiaId) ?? "o item";
    return `"${nome}" tem o Pedido de Produção ${pp.codigo} ativo. Cancele a PP antes de mudar o tipo de custo deste item.`;
  }

  const bvTravado = (bvsRes.data ?? []).find(
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

const alteracaoSchema = z.object({
  job_item_orcado_id: z.string().uuid(),
  valor_unitario: z.number().nonnegative(),
  quantidade: z.number().nonnegative(),
  dias_meses: z.number().nonnegative(),
  tipo_custo: z.enum(TIPOS),
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
});

const payloadSchema = z.object({
  // A "Descrição da errata" do pop-up. Grava em `titulo`, que é a coluna
  // que o card do histórico e o fio da Comunicação já leem. O teto subiu
  // de 200 para 500 em 27/08/2026, quando o campo deixou de ser um título
  // curto e passou a ser a explicação inteira.
  descricao: z
    .string()
    .trim()
    .min(5, "A descrição da errata precisa de pelo menos 5 caracteres.")
    .max(500, "A descrição da errata passa de 500 caracteres."),
  alteracoes: z.array(alteracaoSchema).default([]),
  novas: z.array(novaSchema).default([]),
  remocoes: z.array(z.string().uuid()).default([]),
});

export type AlteracaoErrata = z.infer<typeof alteracaoSchema>;
export type NovaLinhaErrata = z.infer<typeof novaSchema>;
export type PayloadErrata = z.input<typeof payloadSchema>;

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
  /** `null` na remoção, que apaga a linha antes de o item ser gravado. */
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
  efeito: { faturamentoPrevisto: number; valorJob: number };
}

/**
 * Registra uma errata e aplica o que ela decidiu no orçado do job.
 *
 * Desde 27/08/2026 a errata faz três coisas, e não uma:
 *
 * - **corrige** uma linha: R$ unitário, QT, D/M e tipo de custo. QT e D/M
 *   entraram junto com o modo errata na própria planilha — antes eles
 *   ficavam congelados como aprovados.
 * - **cria** linha, normal ou VERMELHA. A vermelha nasce zerada no orçado
 *   e no planejado e serve só para receber PP: é o custo que o orçamento
 *   não previu e que alguém precisa pedir mesmo assim.
 * - **remove** linha, desde que ela ainda não tenha documento nem save.
 *
 * E devolve o job ao mural de abertura: os números que o financeiro usou
 * para montar previsão de recebimento, curva de desembolso e competência
 * acabaram de mudar. O status do job NÃO muda — ele segue aberto e a
 * produção segue trabalhando; o que trava é o envio para faturamento.
 *
 * Grava a errata antes de aplicar: ela guarda a fotografia de custo e
 * faturamento dos dois lados, mais o efeito de cada linha. Isso mantém o
 * histórico legível mesmo que as regras de honorários ou imposto mudem.
 */
export async function registrarErrata(
  jobId: string,
  payload: PayloadErrata,
): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }
  const { descricao, alteracoes, novas, remocoes } = parsed.data;

  if (alteracoes.length + novas.length + remocoes.length === 0) {
    return { ok: false, message: "Nenhuma alteração informada." };
  }

  // ---- Gate: job existe, do tenant, e em status editável ----
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select(
      "id, tenant_id, status, versao_orcamento_aprovada_id, projeto_id, orcamento_id, data_abertura_financeiro",
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
        acao_tentada: "job.errata_registrada",
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
    .select("id, percentual_honorarios, percentual_imposto")
    .eq("id", job.versao_orcamento_aprovada_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (versaoErr || !versao) {
    return { ok: false, message: "Versão aprovada do job não encontrada." };
  }

  const pctHonorarios = Number(versao.percentual_honorarios ?? 0);
  const pctImposto = Number(versao.percentual_imposto ?? 0);

  // Depois do envio o valor da nota está congelado: mexer no orçado agora
  // faria a nota sair por um número que não é mais o do job (27/08/2026).
  if (
    await jobJaEnviadoParaFaturamento(supabase, jobId, session.activeTenant.id)
  ) {
    return { ok: false, message: MENSAGEM_JA_ENVIADO };
  }

  // ---- Estado atual do orçado do job ----
  const { data: itensAtuais, error: itensErr } = await supabase
    .from("jobs_itens_orcado")
    .select(
      "id, item_versao_id, item, grupo_id, ordem, tipo_custo, linha_vermelha, " +
        "valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, total_orcado, " +
        "em_save, save_consumido",
    )
    .eq("job_id", jobId)
    .eq("tenant_id", session.activeTenant.id);

  if (itensErr || !itensAtuais) {
    return { ok: false, message: "Não foi possível ler o orçado do job." };
  }

  const porId = new Map(itensAtuais.map((i: any) => [i.id as string, i]));

  // Nome do grupo entra congelado no histórico.
  const { data: grupos } = await supabase
    .from("versoes_orcamento_grupos")
    .select("id, nome")
    .eq("versao_orcamento_id", job.versao_orcamento_aprovada_id)
    .eq("tenant_id", session.activeTenant.id);
  const nomeDoGrupo = new Map(
    (grupos ?? []).map((g: any) => [g.id as string, g.nome as string]),
  );

  const efeitoDe = (
    de: { total: number; tipoCusto: TipoCusto },
    para: { total: number; tipoCusto: TipoCusto },
  ) => calcularEfeitoDaMudanca(de, para, pctHonorarios, pctImposto);

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

    const mudou =
      alt.valor_unitario !== unitarioDe ||
      alt.quantidade !== qtdDe ||
      alt.dias_meses !== dmDe ||
      alt.tipo_custo !== tipoDe;
    if (!mudou) continue;

    const totalAntes = Number(atual.total_orcado ?? 0);
    const totalDepois = totalDe(
      alt.valor_unitario,
      alt.quantidade,
      alt.dias_meses,
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
      // Os DOIS efeitos: mudar o tipo pode mexer num sem mexer no outro
      // (A · Direto -> A · Repasse move só o faturamento previsto).
      efeito: efeitoDe(
        { total: totalAntes, tipoCusto: tipoDe },
        { total: totalDepois, tipoCusto: alt.tipo_custo },
      ),
    });
  }

  // ---- 2. Remoções ----
  // Só some o que ainda não virou documento nem dinheiro. As FKs dariam
  // um erro de banco em parte destes casos e apagariam em silêncio o
  // resto (`saves_consumos` cascateia) — a trava é aqui, com nome de
  // gente na mensagem.
  const remocoesUnicas = Array.from(new Set(remocoes));
  if (remocoesUnicas.length > 0) {
    const bloqueio = await barrarRemocao(
      jobId,
      session.activeTenant.id,
      remocoesUnicas,
      porId,
    );
    if (bloqueio) return { ok: false, message: bloqueio };

    for (const id of remocoesUnicas) {
      const atual = porId.get(id);
      if (!atual) {
        return {
          ok: false,
          message: "Uma das linhas removidas não pertence a este job.",
        };
      }
      const tipo = atual.tipo_custo as TipoCusto;
      const totalAntes = Number(atual.total_orcado ?? 0);

      mudancas.push({
        acao: "removida",
        copiaId: atual.id,
        itemNome: atual.item,
        grupoId: atual.grupo_id,
        grupoNome: nomeDoGrupo.get(atual.grupo_id) ?? "—",
        linhaVermelha: atual.linha_vermelha === true,
        tipoDe: tipo,
        tipoPara: tipo,
        unitarioDe: Number(atual.valor_unitario_orcado ?? 0),
        unitarioPara: 0,
        qtdDe: Number(atual.quantidade_orcada ?? 1),
        qtdPara: 0,
        dmDe: Number(atual.dias_meses_orcado ?? 1),
        dmPara: 0,
        totalDe: totalAntes,
        totalPara: 0,
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
      efeito: efeitoDe(
        { total: 0, tipoCusto: nova.tipo_custo },
        { total, tipoCusto: nova.tipo_custo },
      ),
    });
  }

  if (mudancas.length === 0) {
    return { ok: false, message: "Nenhum valor foi alterado." };
  }

  // ---- Trava de troca de tipo: PP ativa ou BV já confirmado ----
  // Só a troca de TIPO é barrada — corrigir valor, QT ou D/M de um item
  // com PP ativa continua permitido, como sempre foi. É a troca de tipo
  // que faz BV e PP trocarem de lugar na calha, e ela não pode passar por
  // cima de um documento que já saiu (a PP) nem de dinheiro que já foi ao
  // financeiro (o BV confirmado).
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

  // ---- Totais antes e depois, pela mesma função do card de Totais ----
  const antes = calcularTotaisVersao(
    itensAtuais.map((i: any) => ({
      tipo_custo: i.tipo_custo as TipoCusto,
      total_orcado: Number(i.total_orcado ?? 0),
      em_save: i.em_save === true,
      save_consumido: Number(i.save_consumido ?? 0),
    })),
    pctHonorarios,
    pctImposto,
  );

  const alteradasPorId = new Map(
    mudancas.filter((m) => m.acao === "alterada").map((m) => [m.copiaId, m]),
  );
  const removidasIds = new Set(
    mudancas.filter((m) => m.acao === "removida").map((m) => m.copiaId),
  );

  const depois = calcularTotaisVersao(
    [
      ...itensAtuais
        .filter((i: any) => !removidasIds.has(i.id))
        .map((i: any) => {
          const m = alteradasPorId.get(i.id);
          return {
            tipo_custo: (m ? m.tipoPara : i.tipo_custo) as TipoCusto,
            total_orcado: m ? m.totalPara : Number(i.total_orcado ?? 0),
            em_save: i.em_save === true,
            save_consumido: Number(i.save_consumido ?? 0),
          };
        }),
      // A linha nova entra na conta do "depois" sem existir ainda no banco:
      // é ela que faz o pop-up mostrar o mesmo número que a planilha vai
      // mostrar depois de confirmar.
      ...mudancas
        .filter((m) => m.acao === "nova")
        .map((m) => ({
          tipo_custo: m.tipoPara,
          total_orcado: m.totalPara,
          em_save: false,
          save_consumido: 0,
        })),
    ],
    pctHonorarios,
    pctImposto,
  );

  // ---- Grava a errata ----
  const { data: errata, error: errataErr } = await supabase
    .from("jobs_erratas")
    .insert({
      tenant_id: session.activeTenant.id,
      job_id: jobId,
      // A "Descrição da errata" do pop-up mora aqui: é a coluna que o
      // histórico e o chat já liam. `justificativa` deixou de ser
      // preenchida em 27/08/2026 e fica só para as erratas antigas.
      titulo: descricao,
      justificativa: null,
      // Duas casas em tudo que é dinheiro: `jobs.valor_total` e
      // `valor_job_abertura` também são gravados assim, e sem isso o
      // card de Erratas mostra o mesmo delta com 1 centavo de diferença.
      custo_orcado_antes: dinheiro(antes.subtotalGeral),
      custo_orcado_depois: dinheiro(depois.subtotalGeral),
      valor_job_antes: dinheiro(antes.valorJob),
      valor_job_depois: dinheiro(depois.valorJob),
      faturamento_previsto_antes: dinheiro(antes.faturamentoPrevisto),
      faturamento_previsto_depois: dinheiro(depois.faturamentoPrevisto),
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (errataErr || !errata) {
    console.error("[errata.insert]", errataErr?.message);
    return { ok: false, message: "Falha ao registrar a errata." };
  }

  /** Desfaz a errata quando a aplicação falha no meio. */
  const desfazer = async () => {
    await supabase.from("jobs_erratas").delete().eq("id", errata.id);
  };

  // ---- Aplica: primeiro as linhas novas, que precisam de id ----
  //
  // A ordem importa. A linha nova é inserida antes do item da errata
  // porque `jobs_erratas_itens.job_item_orcado_id` só faz sentido com o id
  // já existindo — e é ele que liga o histórico à linha viva.
  const ordemPorGrupo = new Map<string, number>();
  for (const i of itensAtuais as any[]) {
    const atual = ordemPorGrupo.get(i.grupo_id) ?? 0;
    ordemPorGrupo.set(i.grupo_id, Math.max(atual, Number(i.ordem ?? 0)));
  }

  for (const m of mudancas.filter((x) => x.acao === "nova")) {
    const grupoId = m.grupoId as string;
    const ordem = (ordemPorGrupo.get(grupoId) ?? 0) + 1;
    ordemPorGrupo.set(grupoId, ordem);

    const { data: criada, error: novaErr } = await supabase
      .from("jobs_itens_orcado")
      .insert({
        tenant_id: session.activeTenant.id,
        job_id: jobId,
        // Sem contrapartida na versão: é o que define a linha de errata.
        item_versao_id: null,
        errata_origem_id: errata.id,
        linha_vermelha: m.linhaVermelha,
        grupo_id: grupoId,
        ordem,
        item: m.itemNome,
        tipo_custo: m.tipoPara,
        valor_unitario_orcado: m.unitarioPara,
        quantidade_orcada: m.qtdPara,
        dias_meses_orcado: m.dmPara,
        // O planejado nasce zerado e é preenchido no fluxo normal do
        // planejado. Na vermelha ele fica zerado para sempre — o banco
        // cobra isso em `chk_jio_linha_vermelha_zerada`.
        valor_unitario_planejado: 0,
        quantidade_planejada: 0,
        dias_meses_planejado: 0,
      })
      .select("id")
      .single();

    if (novaErr || !criada) {
      console.error("[errata.linha_nova]", novaErr?.message);
      await desfazer();
      return {
        ok: false,
        message: `Não foi possível criar a linha "${m.itemNome}". A errata não foi registrada.`,
      };
    }

    m.copiaId = criada.id;

    // Âncora do realizado: é nela que a PP se pendura. Sem ela a linha
    // nova — e a vermelha em especial, que existe só para isso — não teria
    // como pedir nada.
    const { error: ancoraErr } = await supabase
      .from("jobs_itens_realizado")
      .insert({
        tenant_id: session.activeTenant.id,
        job_id: jobId,
        item_id: null,
        job_item_orcado_id: criada.id,
        valor_unitario_realizado: 0,
        quantidade_realizada: 0,
        dias_meses_realizado: 0,
        created_by: session.profile.id,
      });

    if (ancoraErr) {
      console.error("[errata.ancora_nova]", ancoraErr.message);
      await supabase.from("jobs_itens_orcado").delete().eq("id", criada.id);
      await desfazer();
      return {
        ok: false,
        message: `A linha "${m.itemNome}" foi criada sem a âncora de realizado e por isso não ficaria apta a gerar PP. A errata não foi registrada.`,
      };
    }
  }

  // ---- Itens da errata ----
  const { error: itensErrataErr } = await supabase
    .from("jobs_erratas_itens")
    .insert(
      mudancas.map((m) => ({
        tenant_id: session.activeTenant.id,
        errata_id: errata.id,
        // Na remoção fica nulo desde já: a linha some logo abaixo, e a FK
        // é `on delete set null` de todo jeito. `item_nome` é o que conta.
        job_item_orcado_id: m.acao === "removida" ? null : m.copiaId,
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
        efeito_valor_job: dinheiro(m.efeito.valorJob),
        efeito_faturamento_previsto: dinheiro(m.efeito.faturamentoPrevisto),
      })),
    );

  if (itensErrataErr) {
    console.error("[errata.itens_insert]", itensErrataErr.message);
    // Errata sem itens não serve de histórico. As linhas novas já criadas
    // saem junto: elas apontam para a errata que está sendo desfeita.
    for (const m of mudancas.filter((x) => x.acao === "nova")) {
      if (m.copiaId) {
        await supabase.from("jobs_itens_orcado").delete().eq("id", m.copiaId);
      }
    }
    await desfazer();
    return { ok: false, message: "Falha ao registrar os itens da errata." };
  }

  // ---- Correções ----
  for (const m of mudancas.filter((x) => x.acao === "alterada")) {
    const { error: updErr } = await supabase
      .from("jobs_itens_orcado")
      .update({
        valor_unitario_orcado: m.unitarioPara,
        quantidade_orcada: m.qtdPara,
        dias_meses_orcado: m.dmPara,
        tipo_custo: m.tipoPara,
        updated_at: new Date().toISOString(),
      })
      .eq("id", m.copiaId as string)
      .eq("tenant_id", session.activeTenant.id);

    if (updErr) {
      console.error("[errata.aplicar]", m.copiaId, updErr.message);
      return {
        ok: false,
        message: `Errata registrada, mas o item "${m.itemNome}" não foi atualizado. Avise o suporte.`,
      };
    }
  }

  // ---- Remoções ----
  // A linha sai por último: a errata já está gravada com `item_nome`, e o
  // cascade leva junto a âncora de realizado e um BV que ainda estivesse
  // "a negociar" — as situações travadas foram barradas lá em cima.
  for (const m of mudancas.filter((x) => x.acao === "removida")) {
    const { error: delErr } = await supabase
      .from("jobs_itens_orcado")
      .delete()
      .eq("id", m.copiaId as string)
      .eq("tenant_id", session.activeTenant.id);

    if (delErr) {
      console.error("[errata.remover]", m.copiaId, delErr.message);
      return {
        ok: false,
        message: `Errata registrada, mas a linha "${m.itemNome}" não foi removida. Avise o suporte.`,
      };
    }
  }

  // ---- BV que perdeu a razão de existir ----
  // Item que sai de A/D deixa de ter comissão a negociar. O BV em
  // "a negociar" é cancelado junto — os travados já foram barrados lá em
  // cima. Ir de A para D não cancela: em D o cliente também paga o
  // fornecedor direto e o BV continua válido.
  const perderamBv = mudancas.filter(
    (m) =>
      m.acao === "alterada" && aceitaBV(m.tipoDe) && !aceitaBV(m.tipoPara),
  );

  for (const m of perderamBv) {
    const { data: bvCancelado } = await supabase
      .from("itens_bv")
      .update({ situacao: "cancelado" })
      .eq("job_item_orcado_id", m.copiaId as string)
      .eq("tenant_id", session.activeTenant.id)
      .eq("situacao", "a_negociar")
      .select("id, valor")
      .maybeSingle<{ id: string; valor: number }>();

    if (bvCancelado) {
      await logAuditEvent({
        acao: "item_bv.cancelado",
        tenantId: session.activeTenant.id,
        entidadeTipo: "item_bv",
        entidadeId: bvCancelado.id,
        metadata: {
          job_item_orcado_id: m.copiaId,
          item: m.itemNome,
          valor: bvCancelado.valor,
          motivo: "errata_mudou_tipo_de_custo",
          errata_id: errata.id,
          tipo_de: m.tipoDe,
          tipo_para: m.tipoPara,
        },
      });
    }
  }

  // `jobs.valor_total` é o Valor do Job; os dois números acompanham o
  // orçado e precisam andar juntos, senão a listagem mostra um par que não
  // fecha com a planilha do job.
  //
  // E a errata devolve o job ao mural de abertura. Só quando o financeiro
  // JÁ abriu: numa errata anterior à abertura não há nada a revisar — o
  // job ainda está na fila de abertura normal.
  const devolveAoMural = job.data_abertura_financeiro !== null;

  await supabase
    .from("jobs")
    .update({
      valor_total: dinheiro(depois.valorJob),
      faturamento_previsto: dinheiro(depois.faturamentoPrevisto),
      faturamento_save_previsto: dinheiro(depois.save.receita),
      ...(devolveAoMural
        ? {
            abertura_em_revisao: true,
            abertura_revisao_desde: new Date().toISOString(),
            abertura_revisao_errata_id: errata.id,
          }
        : {}),
    })
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id);

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
      itens_alterados: contar("alterada"),
      itens_novos: contar("nova"),
      itens_removidos: contar("removida"),
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
 * Barra a remoção de linha que já virou documento ou dinheiro.
 *
 * Sem esta função a remoção seria decidida pelas FKs, e elas discordam
 * entre si: `pedidos_compra` é `on delete restrict` e devolveria um erro
 * cru de banco, enquanto `saves_consumos` é `on delete cascade` e apagaria
 * o consumo em silêncio — devolvendo crédito de save ao job de origem sem
 * que ninguém tivesse pedido.
 *
 * Retorna a mensagem de bloqueio, ou null quando a remoção pode seguir.
 */
async function barrarRemocao(
  jobId: string,
  tenantId: string,
  copiaIds: string[],
  porId: Map<string, any>,
): Promise<string | null> {
  const supabase = createClient();
  const nome = (id: string) => porId.get(id)?.item ?? "a linha";

  // 1. Save: é dinheiro do cliente, e o cascade o devolveria sem aviso.
  for (const id of copiaIds) {
    const linha = porId.get(id);
    if (!linha) continue;
    if (linha.em_save === true) {
      return `"${linha.item}" está marcada como save. Tire a marca de save antes de remover a linha.`;
    }
    if (Number(linha.save_consumido ?? 0) > 0) {
      return `"${linha.item}" é paga com saldo de save de outro job. Desfaça o consumo de save antes de remover a linha.`;
    }
  }

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
    return `"${nome(copiaId)}" tem o Pedido de Produção ${pp.codigo} no histórico. Uma linha com PP não pode ser removida — corrija o valor dela em vez de apagá-la.`;
  }

  const bv = (bvsRes.data ?? [])[0] as
    | { job_item_orcado_id: string; situacao: string }
    | undefined;
  if (bv) {
    return `"${nome(bv.job_item_orcado_id)}" tem BV lançado. Cancele o BV antes de remover a linha.`;
  }

  return null;
}
