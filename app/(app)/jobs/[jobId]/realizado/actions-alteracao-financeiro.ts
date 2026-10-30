"use server";

/**
 * O "Editar planilha" do financeiro — antes "Editar orçado" (decisão 115),
 * desde 30/10/2026 junto com os parâmetros do job (decisão 224).
 *
 * Irmã de `registrarErrata`, com as respostas do Tiago de 28/09/2026:
 *
 * - **Os valores** do orçado — R$ unitário, QT e D/M (P1) — e, desde
 *   08/10/2026, o **tipo de custo**, para qualquer tipo, enquanto nada foi
 *   lançado no item: sem PP (de qualquer situação, a emitir inclusive) e
 *   sem BV (Tiago: "do mesmo modo que com a realização de erratas"). Desde
 *   28/10/2026 a linha com PP ou PP a emitir também troca, mas só entre os
 *   tipos que geram PP (AR, B, C, F, FI); o BV segue travando
 *   (`travaDoTipo`). Linha nova, linha cancelada, linha vermelha e
 *   planejado continuam sendo da errata da produção; no Interno o tipo é
 *   sempre F · Interno.
 * - **Os parâmetros** (decisão 224) — honorários/fee e impostos; no
 *   internacional, int. taxes, Impostos BR, custo de transação e câmbio —
 *   no mesmo rascunho e no mesmo pop-up (revisão de 30/10/2026). Depois da
 *   primeira nota só o câmbio muda.
 * - **Linha com PP já no financeiro é editável** (P2), ao contrário da
 *   errata (decisão 040). Linha com save não: o save tem porta própria, e o
 *   banco recusa de todo jeito (`save_trava_linha_job`).
 * - **Na fila da abertura** (Tiago, 28/09/2026: "desde o momento da
 *   abertura de jobs") a alteração grava na hora, e quem acompanha é o
 *   formulário da abertura, na mesma página — `registrarAlteracaoDoFinanceiro`.
 * - **Com o job aberto** (opção C do protótipo, aprovada em 30/10/2026):
 *   nada acompanha sozinho. "Continuar para a abertura" leva o rascunho até
 *   a aba Abertura do Job sem gravar nada (`preverAlteracaoComRevisao` dá os
 *   números novos), o financeiro ajusta recebimento, curva e impostos à mão,
 *   e o rodapé grava a alteração e a revisão juntas
 *   (`registrarAlteracaoComRevisao`). Só o envio para faturamento ainda sem
 *   nota acompanha, como antes (Tiago, 30/10/2026: "Envio acompanha"): ele é
 *   do faturamento, e a revisão não o edita.
 * - **Até a primeira nota**, mesmo que parcial (P4), **ou o encerramento**
 *   do job — o que vier antes; assim o finalizado nunca edita, nem o Interno,
 *   que não tem nota. No modelo mensal a trava da nota é por mês — só o mês
 *   com nota fica de fora (os parâmetros mexem em todos os meses: qualquer
 *   nota os trava).
 *
 * Os números antes → depois são os do FINANCEIRO (`totaisDoFinanceiro`,
 * decisão 099), os mesmos que a errata grava. A alteração é gravada numa
 * transação só, por `registrar_alteracao_do_financeiro`.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { isAliquotaConhecida } from "@/lib/impostos";
import {
  calcularEfeitoDaMudanca,
  TIPOS_CUSTO,
  tipoGeraDesembolso,
  type VersaoTotais,
} from "@/lib/calculos/versao-totais";
import type { FaturamentoDoMes } from "@/lib/calculos/faturamento-por-mes";
import { nomeDoMes } from "@/lib/calculos/meses-trimestre";
import {
  compraDaCotacao,
  cotacaoValida,
  vendaDaCotacao,
} from "@/lib/calculos/excecao-fechamento";
import { parametrosDaVersao } from "@/lib/calculos/midia-off";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import {
  espelhosDe,
  faturamentoPorMesDoFinanceiro,
  lerBaseDosEspelhos,
  totaisDoFinanceiro,
  type BaseDosEspelhos,
  type LinhaDoEspelho,
} from "@/lib/data/espelhos-do-job";
import { notasEmitidasDosJobs } from "@/lib/data/faturamento-por-job";
import {
  distribuirDelta as distribuir,
  emReais as dinheiro,
  motivoDaTrocaRecusada,
  travaDoTipo,
} from "@/lib/calculos/alteracao-financeiro";
import { travaDoJobDeMidia } from "@/lib/data/midia-do-job";
import {
  edicaoRegistroAberturaSchema,
  type EdicaoRegistroAberturaInput,
} from "@/lib/validations/abertura-financeiro";
import { custoPrevistoDoFinanceiro } from "@/app/(app)/financeiro/abertura-de-job/aprovacao-save";
import { editarRegistroDaAbertura } from "@/app/(app)/financeiro/abertura-de-job/actions";
import {
  JOB_STATUS_ABERTO,
  type EnvioDaAlteracao,
  type JobStatus,
  type ParametrosDoJobGravados,
  type PrevisaoDaAlteracao,
  type TipoCusto,
} from "@/lib/types";

type Result = { ok: true; alteracaoId: string } | { ok: false; message: string };

const linhaSchema = z.object({
  job_item_orcado_id: z.string().uuid(),
  valor_unitario: z.number().nonnegative(),
  quantidade: z.number().nonnegative(),
  dias_meses: z.number().nonnegative(),
  /** O tipo de custo da linha depois da alteração. Ausente = o mesmo de
   *  hoje: é o payload de uma aba aberta antes de 08/10/2026. */
  tipo_custo: z.enum(TIPOS_CUSTO).optional(),
  /** O PLANEJADO da linha depois da alteração — só com o job na fila da
   *  abertura (revisão de 14/10/2026). Ausente = o de hoje. */
  valor_unitario_planejado: z.number().nonnegative().optional(),
  quantidade_planejada: z.number().nonnegative().optional(),
  dias_meses_planejado: z.number().nonnegative().optional(),
});

/** Os parâmetros do job depois da alteração (decisão 224). */
const parametrosSchema = z.object({
  percentual_honorarios: z.number().min(0, "Honorários não podem ser negativos.").max(100, "Honorários vão até 100%."),
  percentual_imposto: z.number().min(0, "Impostos não podem ser negativos.").lt(100, "Impostos precisam ficar abaixo de 100%."),
  percentual_int_taxes: z.number().min(0, "Int. taxes não podem ser negativas.").lt(100, "Int. taxes precisam ficar abaixo de 100%."),
  int_transaction_costs: z.number().min(0, "O custo de transação não pode ser negativo."),
  moeda_estrangeira: z.string().trim().max(3).nullable(),
  cambio_cotacao: z.number().nullable(),
  cambio_data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data da cotação inválida.")
    .nullable(),
  percentual_veiculo: z.number().min(0).max(100, "A parte do veículo vai até 100%."),
  base_honorarios: z.enum(["negociado", "liquido"]),
});

const motivoSchema = z
  .string()
  .trim()
  .min(5, "O motivo da alteração precisa de pelo menos 5 caracteres.")
  .max(500, "O motivo da alteração passa de 500 caracteres.");

const mudancaSchema = z.object({
  linhas: z.array(linhaSchema),
  /** Os parâmetros do rascunho (revisão de 30/10/2026). Ausente = os de
   *  hoje. */
  parametros: parametrosSchema.nullable().optional(),
});

const payloadSchema = mudancaSchema.extend({
  motivo: motivoSchema,
  /** A data de recebimento do faturamento que nasce sem previsão para
   *  acompanhar (revisão de 28/10/2026): um por mês do mensal (`mes` no
   *  primeiro dia), ou um só, com `mes` nulo, nos outros modelos. O valor
   *  não vem da tela: é o faturamento que entra, pela conta do servidor. */
  recebimentos_novos: z
    .array(
      z.object({
        mes: z
          .string()
          .regex(/^\d{4}-\d{2}-01$/, "Mês inválido.")
          .nullable(),
        data_prevista: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de recebimento."),
      }),
    )
    .optional(),
});

export type PayloadAlteracaoFinanceiro = z.input<typeof payloadSchema>;
export type MudancaDoFinanceiro = z.input<typeof mudancaSchema>;

/** O encerramento trava a edição, como a primeira nota (Tiago, 28/09/2026):
 *  encerrado e finalizado ficam de fora. */
const MENSAGEM_JOB_ENCERRADO =
  "O job já foi encerrado: o orçado não muda mais pelo financeiro.";

/** Depois da abertura o planejado é o da abertura (decisão 151); o
 *  financeiro só o edita com o job na fila (revisão de 14/10/2026). */
const MENSAGEM_PLANEJADO_FORA_DA_FILA =
  "o planejado só é editado pelo financeiro com o job na fila da abertura. Depois dela, ele é o da abertura.";

const MENSAGEM_JOB_COM_NOTA =
  "O job já tem nota emitida (faturamento parcial ou total): o orçado não muda mais pelo financeiro.";

const MENSAGEM_PARAMETROS_COM_NOTA =
  "O job já tem nota emitida (faturamento parcial ou total): honorários, impostos e taxas não mudam mais pelo financeiro.";

/** Previsão vazia não tem data a acompanhar. O faturamento que NASCE pede a
 *  data no pop-up (revisão de 28/10/2026); o que diminui sem previsão
 *  nenhuma é dado fora do lugar, e segue para a errata, que leva à revisão
 *  da abertura. */
const SEM_DATA_PARA_ACOMPANHAR =
  "Valor novo precisa de data: peça a errata à produção, que devolve o job para a revisão da abertura.";

/** O faturamento nasceu e o pop-up não mandou a data dele. */
function semDataDoRecebimento(rotulo: string): string {
  return `${rotulo} não tem previsão de recebimento para acompanhar a alteração: informe a data de recebimento no pop-up da alteração.`;
}

const CAMPOS_DO_CAMBIO = ["moeda_estrangeira", "cambio_cotacao", "cambio_data", "cambio_compra", "cambio_venda"];

const num = (v: unknown): number => Number(v ?? 0);
const numOuNulo = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/** O faturamento de cada mês (chave `yyyy-mm`) com as linhas e os
 *  parâmetros num estado — a MESMA conta que fecha o envio do mês e a
 *  parcela do mês na abertura. */
function faturamentoDosMeses(itens: LinhaDoEspelho[], base: BaseDosEspelhos): Map<string, number> {
  return new Map(
    (faturamentoPorMesDoFinanceiro(itens, base) ?? []).map((m) => [m.mes.slice(0, 7), m.faturamento]),
  );
}

interface EnvioLido {
  id: string;
  mes: string | null;
  valor_faturado: number;
  parcelas: Array<{ id: string; ordem: number; data_vencimento: string; valor: number }>;
}

interface PrevisaoLida {
  id: string;
  data_prevista: string;
  mes: string | null;
  valor: number;
}

/** Os números do job com o rascunho — o que a aba Abertura do Job revisa
 *  (opção C). */
export interface NumerosDaAlteracao {
  /** O faturamento previsto de hoje — o "antes" da faixa da revisão. */
  faturamentoPrevistoAntes: number;
  valorJob: number;
  faturamentoPrevisto: number;
  impostoPrevisto: number;
  deducoesDoResultado: number;
  /** Quanto o custo previsto (o planejado dos tipos com PP) muda: a troca
   *  de tipo leva o planejado da linha para dentro ou para fora. */
  deltaCustoPrevisto: number;
  /** Modelo mensal: o faturamento de cada mês com o rascunho. */
  faturamentoPorMes: FaturamentoDoMes[] | null;
}

/**
 * Como as previsões andam:
 * - `acompanham`: a regra de hoje — recebimento e recolhimentos na
 *   proporção, com as mesmas datas; o faturamento que nasce pede a data.
 * - `revisao`: nada acompanha; quem grava as previsões é a revisão da
 *   abertura, logo depois (opção C).
 * Nos dois, o envio ainda sem nota acompanha.
 */
type ModoDasPrevisoes = "acompanham" | "revisao";

interface AlteracaoMontada {
  naAbertura: boolean;
  interno: boolean;
  /** O `p` da RPC, sem o motivo. */
  p: Record<string, any>;
  numeros: NumerosDaAlteracao;
  antes: VersaoTotais;
  depois: VersaoTotais;
  recebimentoAtual: PrevisaoLida[];
  impostosAtuais: PrevisaoLida[];
  auditoria: Record<string, unknown>;
}

type Montagem = { ok: true; montada: AlteracaoMontada } | { ok: false; message: string };

/**
 * Confere e monta a alteração: as travas de sempre (janela, nota, save,
 * linha vermelha, tipo com PP ou BV), os números antes → depois e o
 * payload de `registrar_alteracao_do_financeiro`. Não grava nada — é a
 * mesma conta para gravar e para a prévia da aba Abertura do Job.
 */
async function montarAlteracao(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  entrada: {
    linhas: z.infer<typeof linhaSchema>[];
    parametros: z.infer<typeof parametrosSchema> | null;
    dataDoRecebimentoNovo: Map<string, string>;
  },
  modo: ModoDasPrevisoes,
): Promise<Montagem> {
  const { linhas } = entrada;
  const travaMidia = await travaDoJobDeMidia(supabase, tenantId, jobId, "alteracao");
  if (travaMidia) return { ok: false, message: travaMidia };

  // ---- O job: na abertura, ou aberto e ainda não encerrado ----
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select(
      "id, status, data_abertura_financeiro, versao_orcamento_aprovada_id, orcamento:orcamentos(servico:categorias_dominio!servico_id(investimento_interno), categoria:categorias_dominio!categoria_id(modelo_planilha))",
    )
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (jobErr || !job) return { ok: false, message: "Job não encontrado." };

  // Na fila da abertura ainda não há previsão de recebimento, recolhimento
  // de imposto, envio nem nota: nada disso anda aqui.
  const naAbertura = job.status === "aguardando_abertura";
  const orcamento = (job as {
    orcamento?: {
      servico?: { investimento_interno?: boolean } | null;
      categoria?: { modelo_planilha?: string } | null;
    } | null;
  }).orcamento;
  // Serviço Interno (decisão 105): o banco faz o planejado seguir o orçado.
  const interno = orcamento?.servico?.investimento_interno === true;
  if (
    !naAbertura &&
    (!job.data_abertura_financeiro ||
      !JOB_STATUS_ABERTO.includes(job.status as JobStatus))
  ) {
    const encerrado = job.status === "encerrado" || job.status === "finalizado";
    await logAuditEvent({
      acao: "acao_negada",
      tenantId,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        acao_tentada: "job.orcado_alterado_financeiro",
        motivo: encerrado ? "job_encerrado" : "job_fora_da_janela",
        status_atual: job.status,
      },
    });
    return {
      ok: false,
      message: encerrado
        ? MENSAGEM_JOB_ENCERRADO
        : "O orçado só é editado pelo financeiro com o job na abertura ou já aberto no financeiro.",
    };
  }
  if (modo === "revisao" && naAbertura) {
    return {
      ok: false,
      message: "Com o job na fila da abertura não há revisão: a alteração grava na hora, e o formulário da abertura acompanha.",
    };
  }

  // ---- Tudo que a conta precisa, de uma vez (docs/PERFORMANCE.md) ----
  const [
    baseRes,
    itensRes,
    pedidosRes,
    gruposRes,
    recebimentoRes,
    impostosRes,
    enviosRes,
    notasPorJob,
    parametrosRes,
  ] = await Promise.all([
    lerBaseDosEspelhos(supabase, tenantId, jobId),
    supabase
      .from("jobs_itens_orcado")
      .select(
        "id, item, grupo_id, job_grupo_id, tipo_custo, linha_vermelha, valor_unitario_orcado, quantidade_orcada, dias_meses_orcado, total_orcado, valor_unitario_planejado, quantidade_planejada, dias_meses_planejado, total_planejado, em_save, save_consumido, cancelada_em",
      )
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    supabase
      .from("saves_aprovacoes")
      .select("job_item_orcado_id, situacao")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .in("situacao", ["aguardando", "recusado"]),
    // Os agrupamentos do JOB (decisão 162): o nome que vai para o histórico
    // é o que a planilha mostra; o mês é o mesmo da âncora na versão.
    supabase
      .from("jobs_grupos")
      .select("id, nome, mes_id")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    supabase
      .from("jobs_previsao_recebimento")
      .select("id, ordem, data_prevista, valor, mes")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      // A MESMA ordem em que a tela mostra o pop-up (`previsoesGravadas`):
      // a última parcela fecha o centavo, e a ordem decide qual é a última.
      .order("data_prevista")
      .order("ordem"),
    supabase
      .from("jobs_previsao_impostos")
      .select("id, ordem, data_prevista, valor")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .order("ordem"),
    supabase
      .from("jobs_envio_faturamento")
      .select(
        "id, mes, valor_faturado, parcelas:jobs_envio_faturamento_parcelas(id, ordem, data_vencimento, valor)",
      )
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    notasEmitidasDosJobs(tenantId, [jobId]),
    entrada.parametros
      ? supabase
          .from("vw_parametros_do_job")
          .select(
            "percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs, moeda_estrangeira, cambio_cotacao, cambio_compra, cambio_venda, cambio_data, percentual_veiculo, base_honorarios",
          )
          .eq("job_id", jobId)
          .eq("tenant_id", tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (!baseRes.ok) return { ok: false, message: baseRes.message };
  const base = baseRes.base;
  const erroLeitura =
    itensRes.error ??
    pedidosRes.error ??
    gruposRes.error ??
    recebimentoRes.error ??
    impostosRes.error ??
    enviosRes.error ??
    parametrosRes.error;
  if (erroLeitura || !itensRes.data || (entrada.parametros && !parametrosRes.data)) {
    // Sem saber o estado inteiro (save, envio, previsões), gravar seria
    // deixar alguma parte para trás: melhor parar.
    console.error("[alteracao-financeiro.leitura]", erroLeitura?.message);
    return { ok: false, message: "Não foi possível ler o job agora. Tente de novo." };
  }

  const mensal = base.modeloPlanilha === "mensal";
  const envios: EnvioLido[] = ((enviosRes.data ?? []) as any[]).map((e) => ({
    id: e.id,
    mes: e.mes ?? null,
    valor_faturado: Number(e.valor_faturado ?? 0),
    parcelas: ((e.parcelas ?? []) as any[])
      .map((p) => ({
        id: p.id as string,
        ordem: Number(p.ordem ?? 0),
        data_vencimento: p.data_vencimento as string,
        valor: Number(p.valor ?? 0),
      }))
      .sort((a, b) => a.ordem - b.ordem),
  }));

  // ---- Os parâmetros (decisão 224): só o que o modelo do job tem muda ----
  let parametros: { de: ParametrosDoJobGravados; para: ParametrosDoJobGravados; campos: string[] } | null =
    null;
  if (entrada.parametros && parametrosRes.data) {
    const a = parametrosRes.data as Record<string, unknown>;
    const atual: ParametrosDoJobGravados = {
      percentual_honorarios: num(a.percentual_honorarios),
      percentual_imposto: num(a.percentual_imposto),
      percentual_int_taxes: num(a.percentual_int_taxes),
      int_transaction_costs: num(a.int_transaction_costs),
      moeda_estrangeira: (a.moeda_estrangeira as string | null) ?? null,
      cambio_cotacao: numOuNulo(a.cambio_cotacao),
      cambio_compra: numOuNulo(a.cambio_compra),
      cambio_venda: numOuNulo(a.cambio_venda),
      cambio_data: (a.cambio_data as string | null) ?? null,
      percentual_veiculo: num(a.percentual_veiculo ?? 80),
      base_honorarios: (a.base_honorarios as string) ?? "negociado",
    };
    const modelo = orcamento?.categoria?.modelo_planilha ?? "nacional";
    const internacional = modelo === "internacional";
    const p = entrada.parametros;
    const para: ParametrosDoJobGravados = {
      ...atual,
      percentual_honorarios: p.percentual_honorarios,
      percentual_imposto: p.percentual_imposto,
    };
    if (internacional) {
      para.percentual_int_taxes = p.percentual_int_taxes;
      para.int_transaction_costs = p.int_transaction_costs;
      const moeda = p.moeda_estrangeira ? p.moeda_estrangeira.toUpperCase() : null;
      const cambioMudou =
        moeda !== atual.moeda_estrangeira ||
        p.cambio_cotacao !== atual.cambio_cotacao ||
        p.cambio_data !== atual.cambio_data;
      if (cambioMudou) {
        if (!moeda) return { ok: false, message: "Escolha a moeda do job." };
        if (p.cambio_cotacao === null || !cotacaoValida(p.cambio_cotacao)) {
          return {
            ok: false,
            message: "Informe a cotação do dia, maior que 0,20: compra e venda saem dela (−0,20 e +0,20).",
          };
        }
        // Compra e venda saem da cotação, aqui, como no orçamento.
        para.moeda_estrangeira = moeda;
        para.cambio_cotacao = p.cambio_cotacao;
        para.cambio_compra = compraDaCotacao(p.cambio_cotacao);
        para.cambio_venda = vendaDaCotacao(p.cambio_cotacao);
        para.cambio_data = p.cambio_data;
      }
    }
    // Fora do internacional a alíquota sai da mesma lista do orçamento.
    if (!internacional && para.percentual_imposto !== atual.percentual_imposto) {
      if (!isAliquotaConhecida(para.percentual_imposto)) {
        return { ok: false, message: "Escolha a alíquota de impostos na lista." };
      }
    }
    const campos = (Object.keys(para) as Array<keyof ParametrosDoJobGravados>).filter(
      (k) => para[k] !== atual[k],
    );
    if (campos.length > 0) parametros = { de: atual, para, campos };
  }
  const soCambio = !parametros || parametros.campos.every((k) => CAMPOS_DO_CAMBIO.includes(k));

  // ---- A trava da nota (P4) ----
  // As notas sobre as parcelas dos envios: é por elas que o mês do mensal
  // se reconhece faturado. No job normal, qualquer nota do job trava tudo.
  const idsParcelas = envios.flatMap((e) => e.parcelas.map((p) => p.id));
  const notasDasParcelasRes =
    idsParcelas.length > 0
      ? await supabase
          .from("faturamento_itens")
          .select("envio_parcela_id, faturamento:faturamentos!inner(status)")
          .eq("tenant_id", tenantId)
          .eq("faturamento.status", "emitido")
          .in("envio_parcela_id", idsParcelas)
      : { data: [], error: null };
  if (notasDasParcelasRes.error) {
    console.error("[alteracao-financeiro.notas]", notasDasParcelasRes.error.message);
    return {
      ok: false,
      message: "Não foi possível conferir as notas emitidas deste job. Tente de novo.",
    };
  }
  const parcelasComNota = new Set(
    ((notasDasParcelasRes.data ?? []) as any[]).map((n) => n.envio_parcela_id as string),
  );
  const envioComNota = (e: EnvioLido) => e.parcelas.some((p) => parcelasComNota.has(p.id));
  const temNota = (notasPorJob.get(jobId)?.length ?? 0) > 0 || envios.some(envioComNota);

  if (!mensal && temNota && linhas.length > 0) return { ok: false, message: MENSAGEM_JOB_COM_NOTA };
  // Os parâmetros mexem em todos os meses: no mensal, qualquer mês com nota
  // também trava. O câmbio não muda conta em reais e segue editável.
  if (!naAbertura && !soCambio && temNota) return { ok: false, message: MENSAGEM_PARAMETROS_COM_NOTA };

  // ---- As linhas ----
  const porId = new Map((itensRes.data as any[]).map((i) => [i.id as string, i]));
  const pedidoQuePrende = new Map<string, string>();
  for (const p of (pedidosRes.data ?? []) as any[]) {
    if (p.job_item_orcado_id) pedidoQuePrende.set(p.job_item_orcado_id, p.situacao);
  }
  const grupoPorId = new Map(
    ((gruposRes.data ?? []) as any[]).map((g) => [
      g.id as string,
      { nome: g.nome as string, mesId: (g.mes_id as string | null) ?? null },
    ]),
  );
  const mesPorId = new Map((base.mensal?.meses ?? []).map((m) => [m.id, m.mes]));
  const mesDaLinha = (grupoId: string): string | null => {
    const mesId = grupoPorId.get(grupoId)?.mesId ?? null;
    return mesId ? (mesPorId.get(mesId) ?? null) : null;
  };
  const mesesComNota = new Set(
    envios.filter((e) => e.mes && envioComNota(e)).map((e) => (e.mes as string).slice(0, 7)),
  );

  interface Mudanca {
    id: string;
    item: string;
    grupoId: string;
    grupoNome: string;
    mes: string | null;
    tipoDe: TipoCusto;
    tipoPara: TipoCusto;
    unitDe: number;
    unitPara: number;
    qtdDe: number;
    qtdPara: number;
    dmDe: number;
    dmPara: number;
    totalDe: number;
    totalPara: number;
    planUnitDe: number;
    planUnitPara: number;
    planQtdDe: number;
    planQtdPara: number;
    planDmDe: number;
    planDmPara: number;
    planTotalDe: number;
    planTotalPara: number;
  }
  const mudancas: Mudanca[] = [];

  for (const l of linhas) {
    const atual = porId.get(l.job_item_orcado_id);
    if (!atual) {
      return { ok: false, message: "Uma das linhas alteradas não pertence a este job." };
    }
    const unitDe = Number(atual.valor_unitario_orcado ?? 0);
    const qtdDe = Number(atual.quantidade_orcada ?? 0);
    const dmDe = Number(atual.dias_meses_orcado ?? 0);
    const tipoDe = atual.tipo_custo as TipoCusto;
    const tipoPara = l.tipo_custo ?? tipoDe;
    // O planejado: no Interno ele segue o orçado, como o banco grava; nos
    // outros, o que veio, ou o de hoje.
    const planUnitDe = Number(atual.valor_unitario_planejado ?? 0);
    const planQtdDe = Number(atual.quantidade_planejada ?? 0);
    const planDmDe = Number(atual.dias_meses_planejado ?? 0);
    const planUnitPara = interno ? l.valor_unitario : (l.valor_unitario_planejado ?? planUnitDe);
    const planQtdPara = interno ? l.quantidade : (l.quantidade_planejada ?? planQtdDe);
    const planDmPara = interno ? l.dias_meses : (l.dias_meses_planejado ?? planDmDe);
    const planejadoPedido =
      !interno &&
      (planUnitPara !== planUnitDe || planQtdPara !== planQtdDe || planDmPara !== planDmDe);
    if (
      l.valor_unitario === unitDe &&
      l.quantidade === qtdDe &&
      l.dias_meses === dmDe &&
      tipoPara === tipoDe &&
      !planejadoPedido
    ) {
      continue;
    }
    if (planejadoPedido && !naAbertura) {
      return { ok: false, message: `"${atual.item}": ${MENSAGEM_PLANEJADO_FORA_DA_FILA}` };
    }
    // Linha cancelada por errata (decisão 151): o orçado dela fica zerado.
    if (atual.cancelada_em) {
      return {
        ok: false,
        message: `"${atual.item}" foi cancelada por errata: o orçado dela fica zerado.`,
      };
    }
    if (atual.linha_vermelha === true) {
      return {
        ok: false,
        message: `"${atual.item}" é uma linha vermelha: ela não tem orçado, só recebe realizado por Pedido de Produção.`,
      };
    }
    const pedido = pedidoQuePrende.get(atual.id);
    if (
      atual.em_save === true ||
      Number(atual.save_consumido ?? 0) > 0 ||
      pedido === "aguardando" ||
      pedido === "recusado"
    ) {
      return {
        ok: false,
        message: `"${atual.item}" tem save. Linha com save não entra na edição do orçado — o save muda pelo pop-up da coluna Save.`,
      };
    }
    const mes = mesDaLinha(atual.job_grupo_id);
    if (mensal && mes && mesesComNota.has(mes.slice(0, 7))) {
      const nome = nomeDoMes(mes);
      return {
        ok: false,
        message: `${nome.charAt(0).toUpperCase() + nome.slice(1)} já tem nota emitida: as linhas desse mês não mudam mais pelo financeiro.`,
      };
    }
    mudancas.push({
      id: atual.id,
      item: atual.item,
      grupoId: atual.grupo_id,
      grupoNome: grupoPorId.get(atual.job_grupo_id)?.nome ?? "—",
      mes,
      tipoDe,
      tipoPara,
      unitDe,
      unitPara: l.valor_unitario,
      qtdDe,
      qtdPara: l.quantidade,
      dmDe,
      dmPara: l.dias_meses,
      totalDe: Number(atual.total_orcado ?? 0),
      totalPara: l.valor_unitario * l.quantidade * l.dias_meses,
      planUnitDe,
      planUnitPara,
      planQtdDe,
      planQtdPara,
      planDmDe,
      planDmPara,
      planTotalDe: Number(atual.total_planejado ?? 0),
      planTotalPara: planUnitPara * planQtdPara * planDmPara,
    });
  }

  if (mudancas.length === 0 && !parametros) {
    return { ok: false, message: "Nada foi alterado na planilha." };
  }

  // ---- A troca de tipo: livre sem nada lançado; com PP, entre os tipos
  //      com PP; com BV, não (revisão de 28/10/2026) ----
  // Pela função do banco, que vê as PPs de todas as empresas: a RLS de
  // `pedidos_compra` filtra por empresa, e a trava não pode depender do que
  // o usuário enxerga. A gravação confere de novo, na transação.
  const trocasDeTipo = mudancas.filter((m) => m.tipoPara !== m.tipoDe);
  if (trocasDeTipo.length > 0) {
    const { data: travas, error: travaErr } = await supabase.rpc(
      "travas_do_tipo_nas_linhas_do_job",
      { p_ids: trocasDeTipo.map((m) => m.id) },
    );
    if (travaErr) {
      console.error("[alteracao-financeiro.travas-do-tipo]", travaErr.message);
      return {
        ok: false,
        message: "Não foi possível conferir as PPs e os BVs das linhas. Tente de novo.",
      };
    }
    const travaPorId = new Map(
      (
        (travas ?? []) as Array<{
          job_item_orcado_id: string;
          tem_pp: boolean;
          tem_pp_a_emitir: boolean;
          tem_bv: boolean;
        }>
      ).map((r) => [
        r.job_item_orcado_id,
        { pp: r.tem_pp, ppAEmitir: r.tem_pp_a_emitir, bv: r.tem_bv },
      ]),
    );
    for (const m of trocasDeTipo) {
      const lancamentos = travaPorId.get(m.id);
      if (!lancamentos) continue;
      const recusa = motivoDaTrocaRecusada(travaDoTipo(m.tipoDe, lancamentos), m.tipoPara, m.item);
      if (recusa) return { ok: false, message: recusa };
    }
  }

  // ---- Os números do financeiro, antes e depois ----
  const baseDepois: BaseDosEspelhos = parametros
    ? {
        ...base,
        percentualHonorarios: parametros.para.percentual_honorarios,
        percentualImposto: parametros.para.percentual_imposto,
        internacional: configDaPlanilha(base.modeloPlanilha, parametros.para).internacional,
        midia: base.midia ? parametrosDaVersao(parametros.para) : null,
      }
    : base;
  const antes = totaisDoFinanceiro(base.itens, base);
  const mudancaPorId = new Map(mudancas.map((m) => [m.id, m]));
  const itensDepois: LinhaDoEspelho[] = base.itens.map((i) => {
    const m = mudancaPorId.get(i.id);
    return m
      ? {
          ...i,
          tipo_custo: m.tipoPara,
          total_orcado: m.totalPara,
          valor_unitario_orcado: m.unitPara,
        }
      : i;
  });
  const depois = totaisDoFinanceiro(itensDepois, baseDepois);

  const fatAntes = dinheiro(antes.faturamentoPrevisto);
  const fatDepois = dinheiro(depois.faturamentoPrevisto);
  const impostoAntes = dinheiro(antes.faturamento.imposto + antes.faturamento.intTaxes);
  const impostoDepois = dinheiro(depois.faturamento.imposto + depois.faturamento.intTaxes);

  // ---- A previsão de recebimento e o envio ----
  const recebimentoAtual: PrevisaoLida[] = ((recebimentoRes.data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    data_prevista: r.data_prevista as string,
    mes: (r.mes as string | null) ?? null,
    valor: Number(r.valor ?? 0),
  }));
  const acompanham = modo === "acompanham";
  let recebimentoNovo = recebimentoAtual;
  const enviosNovos = new Map<string, EnvioLido>();
  // O faturamento que nasce sem previsão (revisão de 28/10/2026): uma
  // parcela nova, com a data do pop-up e o valor que entra.
  const recebimentosCriados: Array<{ mes: string | null; data_prevista: string; valor: number }> =
    [];
  const acompanharEnvio = (envio: EnvioLido | undefined, delta: number) => {
    if (!envio || envioComNota(envio) || Math.abs(delta) < 0.005) return;
    enviosNovos.set(envio.id, {
      ...envio,
      valor_faturado: dinheiro(envio.valor_faturado + delta),
      parcelas: distribuir(envio.parcelas, delta),
    });
  };

  if (mensal) {
    // Cada mês recebe o que ele fatura: só os meses cujo faturamento muda
    // andam (os parâmetros mexem em todos).
    const fatMesAntes = faturamentoDosMeses(base.itens, base);
    const fatMesDepois = faturamentoDosMeses(itensDepois, baseDepois);
    for (const chave of new Set([...fatMesAntes.keys(), ...fatMesDepois.keys()])) {
      const delta = dinheiro((fatMesDepois.get(chave) ?? 0) - (fatMesAntes.get(chave) ?? 0));
      if (Math.abs(delta) < 0.005) continue;
      acompanharEnvio(
        envios.find((e) => e.mes?.slice(0, 7) === chave),
        delta,
      );
      if (!acompanham) continue;
      const doMes = recebimentoNovo.filter((r) => r.mes?.slice(0, 7) === chave);
      if (!naAbertura && doMes.length === 0) {
        const nome = nomeDoMes(`${chave}-01`);
        const rotulo = nome.charAt(0).toUpperCase() + nome.slice(1);
        if (delta < 0) {
          return {
            ok: false,
            message: `${rotulo} não tinha faturamento na abertura e não tem previsão de recebimento para acompanhar a alteração. ${SEM_DATA_PARA_ACOMPANHAR}`,
          };
        }
        const data = entrada.dataDoRecebimentoNovo.get(chave);
        if (!data) return { ok: false, message: semDataDoRecebimento(rotulo) };
        recebimentosCriados.push({ mes: `${chave}-01`, data_prevista: data, valor: delta });
        continue;
      }
      const novos = new Map(distribuir(doMes, delta).map((r) => [r.id, r]));
      recebimentoNovo = recebimentoNovo.map((r) => novos.get(r.id) ?? r);
    }
  } else {
    const delta = dinheiro(fatDepois - fatAntes);
    // Linha que não mexe no faturamento (FI, por exemplo) não toca no envio.
    acompanharEnvio(
      envios.find((e) => e.mes === null),
      delta,
    );
    if (acompanham) {
      if (!naAbertura && recebimentoAtual.length === 0 && Math.abs(delta) >= 0.005) {
        if (delta < 0) {
          return {
            ok: false,
            message: `O job abriu sem faturamento previsto e não tem previsão de recebimento para acompanhar a alteração. ${SEM_DATA_PARA_ACOMPANHAR}`,
          };
        }
        const data = entrada.dataDoRecebimentoNovo.get("");
        if (!data) return { ok: false, message: semDataDoRecebimento("O job") };
        recebimentosCriados.push({ mes: null, data_prevista: data, valor: delta });
      }
      recebimentoNovo = distribuir(recebimentoAtual, delta);
    }
  }

  const impostosAtuais: PrevisaoLida[] = ((impostosRes.data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    data_prevista: r.data_prevista as string,
    mes: null,
    valor: Number(r.valor ?? 0),
  }));
  const impostosNovos = acompanham
    ? distribuir(impostosAtuais, dinheiro(impostoDepois - impostoAntes))
    : impostosAtuais;

  // A curva de desembolso não acompanha, nem no Interno, em que o planejado
  // muda junto com o orçado (Tiago, 28/09/2026).

  // O envio não aceita parcela sem valor (`chk_envio_parcela_valor_positivo`),
  // e não se desfaz: melhor a frase aqui do que o erro de constraint.
  const envioZerado = [...enviosNovos.values()].some(
    (e) => e.valor_faturado <= 0 || e.parcelas.some((p) => p.valor <= 0),
  );
  if (envioZerado) {
    return {
      ok: false,
      message:
        "Com essa alteração, uma parcela do envio para faturamento ficaria zerada ou negativa, e o envio não aceita parcela sem valor.",
    };
  }

  const foto = (ls: Array<{ data_prevista: string; valor: number }>): PrevisaoDaAlteracao[] =>
    ls.map((l) => ({ data_prevista: l.data_prevista, valor: l.valor }));
  const fotoEnvio = (e: EnvioLido): EnvioDaAlteracao => ({
    mes: e.mes,
    valor_faturado: e.valor_faturado,
    parcelas: e.parcelas.map((p) => ({ data_vencimento: p.data_vencimento, valor: p.valor })),
  });
  const enviosTocados = envios.filter((e) => enviosNovos.has(e.id));

  // O efeito de cada linha, já com os parâmetros novos, com a última
  // fechando o centavo: honorário e imposto são lineares, mas cada efeito
  // arredondado à parte pode somar 1 centavo diferente do antes → depois.
  // A mudança dos parâmetros fica fora das linhas: ela não é de nenhuma.
  const semAsLinhas = totaisDoFinanceiro(base.itens, baseDepois);
  const efeitos = mudancas.map((m) =>
    calcularEfeitoDaMudanca(
      { total: m.totalDe, tipoCusto: m.tipoDe },
      { total: m.totalPara, tipoCusto: m.tipoPara },
      baseDepois.percentualHonorarios,
      baseDepois.percentualImposto,
      baseDepois.internacional,
    ),
  );
  const efeitoJob = distribuir(
    efeitos.map((e) => ({ valor: dinheiro(e.valorJob) })),
    dinheiro(
      dinheiro(depois.valorJob) -
        dinheiro(semAsLinhas.valorJob) -
        efeitos.reduce((s, e) => s + dinheiro(e.valorJob), 0),
    ),
  );
  const efeitoFat = distribuir(
    efeitos.map((e) => ({ valor: dinheiro(e.faturamentoPrevisto) })),
    dinheiro(
      fatDepois -
        dinheiro(semAsLinhas.faturamentoPrevisto) -
        efeitos.reduce((s, e) => s + dinheiro(e.faturamentoPrevisto), 0),
    ),
  );

  const deltaCustoPrevisto = dinheiro(
    mudancas.reduce(
      (s, m) =>
        s +
        (tipoGeraDesembolso(m.tipoPara) ? m.planTotalPara : 0) -
        (tipoGeraDesembolso(m.tipoDe) ? m.planTotalDe : 0),
      0,
    ),
  );

  const p: Record<string, any> = {
    alteracao: {
      custo_orcado_antes: dinheiro(antes.subtotalGeral),
      custo_orcado_depois: dinheiro(depois.subtotalGeral),
      valor_job_antes: dinheiro(antes.valorJob),
      valor_job_depois: dinheiro(depois.valorJob),
      faturamento_previsto_antes: fatAntes,
      faturamento_previsto_depois: fatDepois,
      recebimento_antes: foto(recebimentoAtual),
      recebimento_depois: [...foto(recebimentoNovo), ...foto(recebimentosCriados)],
      impostos_antes: foto(impostosAtuais),
      impostos_depois: foto(impostosNovos),
      envio_antes: enviosTocados.map(fotoEnvio),
      envio_depois: enviosTocados.map((e) => fotoEnvio(enviosNovos.get(e.id) as EnvioLido)),
    },
    ...(parametros ? { parametros: { de: parametros.de, para: parametros.para } } : {}),
    itens: mudancas.map((m, k) => ({
      job_item_orcado_id: m.id,
      item_nome: m.item,
      grupo_nome: m.grupoNome,
      mes: m.mes,
      tipo_custo: m.tipoDe,
      tipo_custo_para: m.tipoPara,
      valor_unitario_de: m.unitDe,
      valor_unitario_para: m.unitPara,
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
      efeito_valor_job: efeitoJob[k].valor,
      efeito_faturamento_previsto: efeitoFat[k].valor,
    })),
    linhas: mudancas.map((m) => ({
      id: m.id,
      valor_unitario_orcado: m.unitPara,
      quantidade_orcada: m.qtdPara,
      dias_meses_orcado: m.dmPara,
      tipo_custo: m.tipoPara,
      // Só na fila e fora do Interno: no Interno o gatilho do banco
      // faz o planejado seguir o orçado, e depois da abertura o
      // planejado não se mexe (o banco recusa).
      ...(naAbertura && !interno
        ? {
            valor_unitario_planejado: m.planUnitPara,
            quantidade_planejada: m.planQtdPara,
            dias_meses_planejado: m.planDmPara,
          }
        : {}),
    })),
    envios: [...enviosNovos.values()].map((e) => ({ id: e.id, valor_faturado: e.valor_faturado })),
    parcelas_envio: [...enviosNovos.values()].flatMap((e) =>
      e.parcelas.map((x) => ({ id: x.id, valor: x.valor })),
    ),
    recebimento: recebimentoNovo
      .filter((r, k) => r.valor !== recebimentoAtual[k]?.valor)
      .map((r) => ({ id: r.id, valor: r.valor })),
    impostos: impostosNovos
      .filter((r, k) => r.valor !== impostosAtuais[k]?.valor)
      .map((r) => ({ id: r.id, valor: r.valor })),
    recebimento_novo: recebimentosCriados,
    espelhos: espelhosDe(depois),
  };

  return {
    ok: true,
    montada: {
      naAbertura,
      interno,
      p,
      antes,
      depois,
      recebimentoAtual,
      impostosAtuais,
      numeros: {
        faturamentoPrevistoAntes: fatAntes,
        valorJob: dinheiro(depois.valorJob),
        faturamentoPrevisto: fatDepois,
        impostoPrevisto: impostoDepois,
        deducoesDoResultado: dinheiro(depois.deducoesDoResultado),
        deltaCustoPrevisto,
        faturamentoPorMes: mensal ? faturamentoPorMesDoFinanceiro(itensDepois, baseDepois) : null,
      },
      auditoria: {
        itens_alterados: mudancas.length,
        planejados_alterados: mudancas
          .filter(
            (m) =>
              !interno &&
              (m.planUnitDe !== m.planUnitPara ||
                m.planQtdDe !== m.planQtdPara ||
                m.planDmDe !== m.planDmPara),
          )
          .map((m) => ({
            job_item_orcado_id: m.id,
            de: dinheiro(m.planTotalDe),
            para: dinheiro(m.planTotalPara),
          })),
        tipos_alterados: trocasDeTipo.map((m) => ({
          job_item_orcado_id: m.id,
          de: m.tipoDe,
          para: m.tipoPara,
        })),
        parametros_alterados: parametros
          ? {
              campos: parametros.campos,
              de: Object.fromEntries(parametros.campos.map((k) => [k, parametros!.de[k as keyof ParametrosDoJobGravados]])),
              para: Object.fromEntries(parametros.campos.map((k) => [k, parametros!.para[k as keyof ParametrosDoJobGravados]])),
            }
          : null,
        valor_job_antes: dinheiro(antes.valorJob),
        valor_job_depois: dinheiro(depois.valorJob),
        faturamento_previsto_antes: fatAntes,
        faturamento_previsto_depois: fatDepois,
        envios_acompanharam: enviosTocados.length,
        recebimentos_criados: recebimentosCriados,
      },
    },
  };
}

/** Grava a alteração montada. */
async function gravarAlteracao(
  supabase: SupabaseClient,
  jobId: string,
  motivo: string,
  p: Record<string, any>,
): Promise<{ ok: true; alteracaoId: string } | { ok: false; message: string }> {
  const { data: alteracaoId, error: gravarErr } = await supabase.rpc(
    "registrar_alteracao_do_financeiro",
    { p_job_id: jobId, p: { ...p, alteracao: { ...p.alteracao, motivo } } },
  );
  if (gravarErr || !alteracaoId) {
    console.error("[alteracao-financeiro.gravar]", gravarErr?.message);
    // P0001 é mensagem nossa, escrita para a tela (as travas do banco).
    const doBanco =
      gravarErr?.code === "P0001" && gravarErr.message ? ` ${gravarErr.message}` : "";
    return {
      ok: false,
      message: `Não foi possível registrar a alteração, e nada foi gravado.${doBanco}`,
    };
  }
  return { ok: true, alteracaoId: alteracaoId as string };
}

function revalidarOJob(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/financeiro/jobs/${jobId}`);
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/abertura-de-job/${jobId}`);
}

/**
 * A alteração que grava na hora, com as previsões acompanhando: o job na
 * fila da abertura (o formulário da abertura acompanha na tela) — e, para
 * aba aberta antes de 30/10/2026, o job aberto.
 */
export async function registrarAlteracaoDoFinanceiro(
  jobId: string,
  payload: PayloadAlteracaoFinanceiro,
): Promise<Result> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.editar_orcado_financeiro");
  if (!gate.ok) return gate;

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { motivo } = parsed.data;
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const montagem = await montarAlteracao(
    supabase,
    tenantId,
    jobId,
    {
      linhas: parsed.data.linhas,
      parametros: parsed.data.parametros ?? null,
      dataDoRecebimentoNovo: new Map(
        (parsed.data.recebimentos_novos ?? []).map((r) => [r.mes?.slice(0, 7) ?? "", r.data_prevista]),
      ),
    },
    "acompanham",
  );
  if (!montagem.ok) return montagem;
  const { montada } = montagem;

  const gravada = await gravarAlteracao(supabase, jobId, motivo, montada.p);
  if (!gravada.ok) return gravada;

  await logAuditEvent({
    acao: "job.orcado_alterado_financeiro",
    tenantId,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: { alteracao_id: gravada.alteracaoId, motivo, ...montada.auditoria },
  });

  revalidarOJob(jobId);
  return gravada;
}

/**
 * "Continuar para a abertura" (opção C, 30/10/2026): os números do job com
 * o rascunho, pela MESMA conta que a gravação faz — é sobre eles que a aba
 * Abertura do Job revisa as previsões. Não grava nada.
 */
export async function preverAlteracaoComRevisao(
  jobId: string,
  mudanca: MudancaDoFinanceiro,
): Promise<{ ok: true; numeros: NumerosDaAlteracao } | { ok: false; message: string }> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.editar_orcado_financeiro");
  if (!gate.ok) return gate;

  const parsed = mudancaSchema.safeParse(mudanca);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const montagem = await montarAlteracao(
    createClient(),
    session.activeTenant.id,
    jobId,
    {
      linhas: parsed.data.linhas,
      parametros: parsed.data.parametros ?? null,
      dataDoRecebimentoNovo: new Map(),
    },
    "revisao",
  );
  if (!montagem.ok) return montagem;
  return { ok: true, numeros: montagem.montada.numeros };
}

const revisaoSchema = mudancaSchema.extend({ motivo: motivoSchema });

/** Diferença em centavos — a mesma tolerância da abertura. */
const naoFecha = (soma: number, total: number) => Math.abs(Math.round(soma * 100) - Math.round(total * 100)) >= 1;
const somaDe = (ls: Array<{ valor: number }>) => ls.reduce((s, l) => s + l.valor, 0);

/**
 * O rodapé "Registrar alteração e revisão" (opção C, 30/10/2026): grava a
 * alteração da planilha e, em seguida, a revisão da abertura com as
 * previsões que o financeiro ajustou, que viram a foto "alteração do
 * financeiro" no histórico do registro.
 *
 * As duas gravações são de funções diferentes: antes da primeira, o
 * registro é conferido contra os números novos (recebimento, curva e
 * impostos fechando), para a segunda não ficar para trás por dado
 * incompleto.
 */
export async function registrarAlteracaoComRevisao(
  jobId: string,
  payload: z.input<typeof revisaoSchema>,
  registro: EdicaoRegistroAberturaInput,
): Promise<
  | { ok: true; alteracaoId: string }
  | { ok: false; message: string; alteracaoGravada?: boolean }
> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.editar_orcado_financeiro");
  if (!gate.ok) return gate;
  // O registro da abertura é do administrador e do financeiro (o mesmo
  // gate de `editarRegistroDaAbertura`): confere antes de gravar a
  // alteração, para não deixar a revisão para trás.
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: "Só administrador ou financeiro registra a revisão da abertura." };
  }

  const parsed = revisaoSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const registroLido = edicaoRegistroAberturaSchema.safeParse(registro);
  if (!registroLido.success) {
    // O formulário manda o registro completo; o que falta aqui é dado fora
    // do lugar, e a frase do Zod não diz onde.
    return { ok: false, message: "Confira os campos da aba Abertura do Job antes de registrar." };
  }
  const reg = registroLido.data;
  const { motivo } = parsed.data;
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  const montagem = await montarAlteracao(
    supabase,
    tenantId,
    jobId,
    {
      linhas: parsed.data.linhas,
      parametros: parsed.data.parametros ?? null,
      dataDoRecebimentoNovo: new Map(),
    },
    "revisao",
  );
  if (!montagem.ok) return montagem;
  const { montada } = montagem;
  const n = montada.numeros;

  // ---- O registro fecha com os números novos? ----
  if (n.faturamentoPrevisto <= 0 ? reg.recebimento.length > 0 : !n.faturamentoPorMes && naoFecha(somaDe(reg.recebimento), n.faturamentoPrevisto)) {
    return { ok: false, message: "As parcelas de recebimento precisam somar o faturamento previsto novo." };
  }
  if (n.impostoPrevisto <= 0 ? reg.impostos.length > 0 : naoFecha(somaDe(reg.impostos), n.impostoPrevisto)) {
    return { ok: false, message: "O recolhimento de impostos precisa somar os impostos previstos novos." };
  }
  const custoLido = await custoPrevistoDoFinanceiro(supabase, tenantId, jobId, null);
  if (!custoLido.ok) return { ok: false, message: custoLido.message };
  const custoDepois = dinheiro(custoLido.custo + n.deltaCustoPrevisto);
  if (custoDepois <= 0 ? reg.curva.length > 0 : naoFecha(somaDe(reg.curva), custoDepois)) {
    return { ok: false, message: "A curva precisa somar o custo previsto novo." };
  }

  // A alteração guarda as previsões de antes e as que a revisão grava.
  const p = {
    ...montada.p,
    alteracao: {
      ...montada.p.alteracao,
      recebimento_depois: reg.recebimento.map((l) => ({ data_prevista: l.data_prevista, valor: l.valor })),
      impostos_depois: reg.impostos.map((l) => ({ data_prevista: l.data_prevista, valor: l.valor })),
    },
  };
  const gravada = await gravarAlteracao(supabase, jobId, motivo, p);
  if (!gravada.ok) return gravada;

  await logAuditEvent({
    acao: "job.orcado_alterado_financeiro",
    tenantId,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      alteracao_id: gravada.alteracaoId,
      motivo,
      com_revisao_da_abertura: true,
      ...montada.auditoria,
    },
  });

  const revisao = await editarRegistroDaAbertura(jobId, registro, null, gravada.alteracaoId);
  revalidarOJob(jobId);
  if (!revisao.ok) {
    console.error("[alteracao-financeiro.revisao]", revisao.message);
    return {
      ok: false,
      alteracaoGravada: true,
      message: `A alteração da planilha foi gravada, mas a revisão da abertura não: ${revisao.message} Ajuste as previsões pelo Editar registro, na aba Abertura do Job.`,
    };
  }
  return gravada;
}
