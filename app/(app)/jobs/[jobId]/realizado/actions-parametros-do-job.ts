"use server";

/**
 * Os parâmetros do job editados pelo financeiro (decisão 224).
 *
 * Irmã do "Editar orçado" (decisão 115, `registrarAlteracaoDoFinanceiro`),
 * com as respostas do Tiago de 27/10/2026:
 *
 * - **O quê:** honorários/fee e impostos em todo modelo; no internacional
 *   também int. taxes, Impostos BR e custo de transação (sem passar pela
 *   Exceção do administrador da decisão 206) e o câmbio; na Mídia Off, a
 *   base dos honorários e a parte do veículo.
 * - **Onde grava:** no JOB (`jobs_parametros`). A versão aprovada continua
 *   como o cliente aprovou.
 * - **Quando:** com o job na fila da abertura. Depois da abertura, só o
 *   câmbio do internacional — ele não muda conta em reais, só a coluna da
 *   moeda.
 * - **Motivo obrigatório**, no pop-up do Salvar, e o registro vai para
 *   Alterações do Financeiro.
 *
 * Na fila ainda não há previsão de recebimento, recolhimento de imposto,
 * envio nem nota: o que acompanha é o formulário da aba Abertura do Job,
 * que lê os números novos do servidor. Os números do job (valor, faturamento
 * previsto e a foto da abertura) são gravados na mesma transação, por
 * `registrar_alteracao_do_financeiro`.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { isAliquotaConhecida } from "@/lib/impostos";
import {
  compraDaCotacao,
  cotacaoValida,
  vendaDaCotacao,
} from "@/lib/calculos/excecao-fechamento";
import { parametrosDaVersao } from "@/lib/calculos/midia-off";
import { emReais as dinheiro } from "@/lib/calculos/alteracao-financeiro";
import { configDaPlanilha } from "@/app/(app)/_planilha/modelo-planilha";
import {
  espelhosDe,
  lerBaseDosEspelhos,
  totaisDoFinanceiro,
  type BaseDosEspelhos,
} from "@/lib/data/espelhos-do-job";
import type { JobStatus, ParametrosDoJobGravados } from "@/lib/types";

type Result = { ok: true; alteracaoId: string } | { ok: false; message: string };

const paraSchema = z.object({
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

const payloadSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(5, "O motivo da alteração precisa de pelo menos 5 caracteres.")
    .max(500, "O motivo da alteração passa de 500 caracteres."),
  para: paraSchema,
});

export type PayloadParametrosDoJob = z.input<typeof payloadSchema>;

const CAMPOS_DO_CAMBIO = ["moeda_estrangeira", "cambio_cotacao", "cambio_data"] as const;

const num = (v: unknown): number => Number(v ?? 0);
const numOuNulo = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export async function alterarParametrosDoJob(
  jobId: string,
  payload: PayloadParametrosDoJob,
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

  // ---- O job, os parâmetros de agora e a base da conta, de uma vez ----
  const [jobRes, atualRes, baseRes] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, status, data_abertura_financeiro, orcamento:orcamentos(categoria:categorias_dominio!categoria_id(modelo_planilha))",
      )
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("vw_parametros_do_job")
      .select(
        "percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs, moeda_estrangeira, cambio_cotacao, cambio_compra, cambio_venda, cambio_data, percentual_veiculo, base_honorarios",
      )
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    lerBaseDosEspelhos(supabase, tenantId, jobId, { comMeses: false }),
  ]);
  const job = jobRes.data as {
    id: string;
    status: JobStatus;
    data_abertura_financeiro: string | null;
    orcamento: { categoria: { modelo_planilha: string } | null } | null;
  } | null;
  if (jobRes.error || !job) return { ok: false, message: "Job não encontrado." };
  if (atualRes.error || !atualRes.data) {
    console.error("[parametros-do-job.atual]", atualRes.error?.message);
    return { ok: false, message: "Não foi possível ler os parâmetros do job agora. Tente de novo." };
  }
  if (!baseRes.ok) return { ok: false, message: baseRes.message };
  const base: BaseDosEspelhos = baseRes.base;

  const naFila = job.status === "aguardando_abertura";
  // A mesma janela do "Editar orçado" (e da função do banco): até o
  // encerramento.
  const aberto =
    !!job.data_abertura_financeiro && (job.status === "aberto" || job.status === "em_producao");
  if (!naFila && !aberto) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        acao_tentada: "job.parametros_alterados_financeiro",
        motivo: "job_fora_da_janela",
        status_atual: job.status,
      },
    });
    return {
      ok: false,
      message:
        "Os parâmetros só são editados pelo financeiro na abertura do job (e o câmbio, com o job aberto).",
    };
  }

  const a = atualRes.data as Record<string, unknown>;
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

  // ---- O retrato novo: só o que o modelo do job tem muda ----
  const modelo = job.orcamento?.categoria?.modelo_planilha ?? "nacional";
  const internacional = modelo === "internacional";
  const midiaOff = modelo === "midia_off";
  const p = parsed.data.para;
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
  if (midiaOff) {
    para.percentual_veiculo = p.percentual_veiculo;
    para.base_honorarios = p.base_honorarios;
  }
  // Fora do internacional a alíquota sai da mesma lista do orçamento.
  if (!internacional && para.percentual_imposto !== atual.percentual_imposto) {
    if (!isAliquotaConhecida(para.percentual_imposto)) {
      return { ok: false, message: "Escolha a alíquota de impostos na lista." };
    }
  }

  const mudou = (Object.keys(para) as Array<keyof ParametrosDoJobGravados>).filter(
    (k) => para[k] !== atual[k],
  );
  if (mudou.length === 0) return { ok: false, message: "Nenhum parâmetro mudou." };
  if (!naFila && mudou.some((k) => !(CAMPOS_DO_CAMBIO as readonly string[]).includes(k) && k !== "cambio_compra" && k !== "cambio_venda")) {
    return {
      ok: false,
      message: "Depois da abertura só o câmbio muda: honorários, impostos e taxas ficam como o job abriu.",
    };
  }

  // ---- Os números do financeiro, antes e depois ----
  const planilhaDepois = configDaPlanilha(base.modeloPlanilha, para);
  const baseDepois: BaseDosEspelhos = {
    ...base,
    percentualHonorarios: para.percentual_honorarios,
    percentualImposto: para.percentual_imposto,
    internacional: planilhaDepois.internacional,
    midia: base.midia ? parametrosDaVersao(para) : null,
  };
  const antes = totaisDoFinanceiro(base.itens, base);
  const depois = totaisDoFinanceiro(base.itens, baseDepois);
  const fatAntes = dinheiro(antes.faturamentoPrevisto);
  const fatDepois = dinheiro(depois.faturamentoPrevisto);
  // Depois da abertura nada em reais pode mudar: só o câmbio, que não entra
  // na conta. Se mudasse, as previsões gravadas ficariam para trás.
  if (!naFila && (fatAntes !== fatDepois || dinheiro(antes.valorJob) !== dinheiro(depois.valorJob))) {
    return { ok: false, message: "Com o job aberto, a alteração não pode mudar o faturamento previsto." };
  }

  const { data: alteracaoId, error: gravarErr } = await supabase.rpc(
    "registrar_alteracao_do_financeiro",
    {
      p_job_id: jobId,
      p: {
        alteracao: {
          motivo,
          custo_orcado_antes: dinheiro(antes.subtotalGeral),
          custo_orcado_depois: dinheiro(depois.subtotalGeral),
          valor_job_antes: dinheiro(antes.valorJob),
          valor_job_depois: dinheiro(depois.valorJob),
          faturamento_previsto_antes: fatAntes,
          faturamento_previsto_depois: fatDepois,
        },
        parametros: { de: atual, para },
        itens: [],
        linhas: [],
        espelhos: espelhosDe(depois),
      },
    },
  );

  if (gravarErr || !alteracaoId) {
    console.error("[parametros-do-job.gravar]", gravarErr?.message);
    const doBanco =
      gravarErr?.code === "P0001" && gravarErr.message ? ` ${gravarErr.message}` : "";
    return {
      ok: false,
      message: `Não foi possível gravar a alteração, e nada foi gravado.${doBanco}`,
    };
  }

  await logAuditEvent({
    acao: "job.parametros_alterados_financeiro",
    tenantId,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      alteracao_id: alteracaoId,
      motivo,
      na_fila: naFila,
      campos: mudou,
      de: Object.fromEntries(mudou.map((k) => [k, atual[k]])),
      para: Object.fromEntries(mudou.map((k) => [k, para[k]])),
      valor_job_antes: dinheiro(antes.valorJob),
      valor_job_depois: dinheiro(depois.valorJob),
      faturamento_previsto_antes: fatAntes,
      faturamento_previsto_depois: fatDepois,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/financeiro/jobs/${jobId}`);
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/abertura-de-job/${jobId}`);
  return { ok: true, alteracaoId: alteracaoId as string };
}
