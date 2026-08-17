"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  aberturaFinanceiraSchema,
  TOLERANCIA_CURVA,
  type AberturaFinanceiraInput,
} from "@/lib/validations/abertura-financeiro";
import type { JobStatus, TipoCusto } from "@/lib/types";
import { tipoGeraDesembolso } from "@/lib/calculos/versao-totais";
import { ehJanelaDePagamento, emCentavos, somaCurva } from "./curva";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Abre o job no financeiro: grava o registro contábil (nome financeiro,
 * categoria, competência, custo previsto, curva de desembolso e previsão
 * de recebimento) e só então muda o status para `aberto`.
 *
 * Nenhum dos dois totais vem do formulário — são dinheiro, e o navegador
 * não é fonte confiável para dinheiro:
 *
 *   * o CUSTO previsto é relido de `jobs_itens_orcado` aqui dentro, e
 *     soma SÓ os itens de calha PP (AR, B, C, F, FI): são os únicos em
 *     que a California paga o fornecedor. Itens A e D são pagos direto
 *     pelo cliente e nunca viram previsão de desembolso
 *     (docs/decisions/004). Job 100% A/D abre com custo zero e curva
 *     vazia — é legítimo, não é erro;
 *   * o FATURAMENTO previsto é relido de `jobs.faturamento_previsto`, e
 *     é contra ele que as parcelas de recebimento fecham. Não é o
 *     `valor_total`, que inclui o que o cliente paga direto ao
 *     fornecedor e nunca passa pelo caixa da California.
 */
export async function abrirJobNoFinanceiro(
  jobId: string,
  input: AberturaFinanceiraInput,
): Promise<ActionResult> {
  const session = await requireSession();

  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: { action: "job.abrirNoFinanceiro", role: session.activeRole },
    });
    return {
      ok: false,
      message: "Só administrador ou financeiro pode abrir jobs.",
    };
  }

  const parsed = aberturaFinanceiraSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, projeto_id, orcamento_id, faturamento_previsto")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: JobStatus;
      projeto_id: string;
      orcamento_id: string;
      faturamento_previsto: number | string | null;
    }>();

  if (!job) return { ok: false, message: "Job não encontrado." };
  if (job.status !== "aguardando_abertura") {
    return {
      ok: false,
      message:
        "Este job não está mais aguardando abertura — alguém pode ter aberto ou reprovado enquanto você preenchia.",
    };
  }

  // A categoria precisa ser do escopo 'job' e do mesmo tenant. Sem esta
  // conferência, um id de categoria de projeto passaria pela FK.
  const { data: categoria } = await supabase
    .from("categorias_dominio")
    .select("id, escopo, ativo")
    .eq("id", parsed.data.categoria_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ id: string; escopo: string; ativo: boolean }>();

  if (!categoria || categoria.escopo !== "job") {
    return { ok: false, message: "Categoria de job inválida." };
  }
  if (!categoria.ativo) {
    return {
      ok: false,
      message: "Esta categoria foi inativada. Escolha outra para abrir o job.",
    };
  }

  // ---------- Custo previsto: relido do banco, não do formulário ----------
  const { data: itens, error: itensErro } = await supabase
    .from("jobs_itens_orcado")
    .select("tipo_custo, total_planejado")
    .eq("job_id", jobId)
    .eq("tenant_id", session.activeTenant.id);

  if (itensErro) {
    console.error("[abertura-job.planejado]", itensErro.message);
    return { ok: false, message: "Não foi possível ler a planilha do job." };
  }

  const custoPrevisto = emCentavos(
    (itens ?? []).reduce(
      (
        s,
        i: { tipo_custo: TipoCusto; total_planejado: number | string | null },
      ) =>
        tipoGeraDesembolso(i.tipo_custo)
          ? s + Number(i.total_planejado ?? 0)
          : s,
      0,
    ),
  );

  const semDesembolso = custoPrevisto <= 0;

  if (semDesembolso && parsed.data.curva.length > 0) {
    return {
      ok: false,
      message:
        "Este job não tem desembolso previsto pela California — a curva precisa ficar vazia.",
    };
  }

  if (!semDesembolso) {
    if (parsed.data.curva.length === 0) {
      return {
        ok: false,
        message: "A curva de desembolso precisa de pelo menos uma data.",
      };
    }

    const soma = somaCurva(parsed.data.curva);
    if (Math.abs(soma - custoPrevisto) >= TOLERANCIA_CURVA) {
      return {
        ok: false,
        message: `A curva de desembolso soma ${soma.toFixed(2)} e o custo previsto é ${custoPrevisto.toFixed(2)}. Ajuste as datas antes de abrir.`,
      };
    }

    // Pagamento só acontece nas janelas (dia 08 e 20, ajustadas para o
    // dia útil seguinte). Regra crítica não depende só do formulário.
    const foraDeJanela = parsed.data.curva.find(
      (l) => !ehJanelaDePagamento(l.data_prevista),
    );
    if (foraDeJanela) {
      return {
        ok: false,
        message: `A data ${foraDeJanela.data_prevista} não é uma janela de pagamento (dias 08 e 20, ou o dia útil seguinte).`,
      };
    }
  }

  // ---------- Faturamento previsto: relido do banco, como o custo ----------
  // As parcelas de recebimento NÃO seguem as janelas de pagamento: elas
  // são entrada de dinheiro, e quem manda na data é o cliente.
  const faturamentoPrevisto = emCentavos(
    Number(job.faturamento_previsto ?? 0),
  );
  const semRecebimento = faturamentoPrevisto <= 0;

  if (semRecebimento && parsed.data.recebimento.length > 0) {
    return {
      ok: false,
      message:
        "Este job não tem faturamento previsto pela California — a previsão de recebimento precisa ficar vazia.",
    };
  }

  if (!semRecebimento) {
    if (parsed.data.recebimento.length === 0) {
      return {
        ok: false,
        message: "A previsão de recebimento precisa de pelo menos uma parcela.",
      };
    }

    const somaReceb = somaCurva(parsed.data.recebimento);
    if (Math.abs(somaReceb - faturamentoPrevisto) >= TOLERANCIA_CURVA) {
      return {
        ok: false,
        message: `As parcelas de recebimento somam ${somaReceb.toFixed(2)} e o faturamento previsto é ${faturamentoPrevisto.toFixed(2)}. Ajuste os valores antes de abrir.`,
      };
    }
  }

  const agora = new Date().toISOString();

  const { error: updateErro } = await supabase
    .from("jobs")
    .update({
      status: "aberto",
      motivo_rejeicao: null,
      nome_financeiro: parsed.data.nome_financeiro,
      categoria_id: parsed.data.categoria_id,
      competencia_trimestre: parsed.data.competencia_trimestre,
      competencia_ano: parsed.data.competencia_ano,
      custo_previsto_total: custoPrevisto,
      data_abertura_financeiro: agora,
      aberto_por: session.profile.id,
    })
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    // Trava de corrida: se outra aba abriu o job entre a leitura acima e
    // este update, o filtro não casa e nada é gravado duas vezes.
    .eq("status", "aguardando_abertura");

  if (updateErro) {
    console.error("[abertura-job.update]", updateErro.message);
    return { ok: false, message: "Não foi possível abrir o job." };
  }

  // As duas previsões são regravadas inteiras: apaga o que houver e
  // insere de novo. Na abertura não há nada para apagar, mas a edição
  // futura usa o mesmo caminho.
  const [deleteCurva, deleteReceb] = await Promise.all([
    supabase
      .from("jobs_previsao_custo")
      .delete()
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id),
    supabase
      .from("jobs_previsao_recebimento")
      .delete()
      .eq("job_id", jobId)
      .eq("tenant_id", session.activeTenant.id),
  ]);

  if (deleteCurva.error) {
    console.error("[abertura-job.curva-delete]", deleteCurva.error.message);
  }
  if (deleteReceb.error) {
    console.error(
      "[abertura-job.recebimento-delete]",
      deleteReceb.error.message,
    );
  }

  const linhaPrevisao = (
    linha: { data_prevista: string; valor: number },
    i: number,
  ) => ({
    tenant_id: session.activeTenant.id,
    job_id: jobId,
    ordem: i + 1,
    data_prevista: linha.data_prevista,
    valor: linha.valor,
    created_by: session.profile.id,
  });

  const [curvaRes, recebRes] = await Promise.all([
    semDesembolso
      ? Promise.resolve({ error: null })
      : supabase
          .from("jobs_previsao_custo")
          .insert(parsed.data.curva.map(linhaPrevisao)),
    semRecebimento
      ? Promise.resolve({ error: null })
      : supabase
          .from("jobs_previsao_recebimento")
          .insert(parsed.data.recebimento.map(linhaPrevisao)),
  ]);

  const curvaErro = curvaRes.error;
  const recebErro = recebRes.error;

  if (curvaErro || recebErro) {
    // O job já está aberto e o registro contábil gravado. Voltar o status
    // aqui seria pior: o financeiro veria o job sumir da fila e reaparecer.
    // Melhor abrir sem a previsão e deixar o alerta explícito.
    if (curvaErro) {
      console.error("[abertura-job.curva-insert]", curvaErro.message);
    }
    if (recebErro) {
      console.error("[abertura-job.recebimento-insert]", recebErro.message);
    }
    await logAuditEvent({
      acao: "job.aberto_no_financeiro",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: {
        curva_falhou: Boolean(curvaErro),
        recebimento_falhou: Boolean(recebErro),
        erro: (curvaErro ?? recebErro)?.message,
      },
    });
    const oQueFalhou =
      curvaErro && recebErro
        ? "a curva de desembolso e a previsão de recebimento não foram gravadas"
        : curvaErro
          ? "a curva de desembolso não foi gravada"
          : "a previsão de recebimento não foi gravada";
    return {
      ok: false,
      message: `O job foi aberto, mas ${oQueFalhou}. Registre as datas na página do job.`,
    };
  }

  await logAuditEvent({
    acao: "job.aberto_no_financeiro",
    tenantId: session.activeTenant.id,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      nome_financeiro: parsed.data.nome_financeiro,
      categoria_id: parsed.data.categoria_id,
      competencia: `${parsed.data.competencia_trimestre}T/${parsed.data.competencia_ano}`,
      custo_previsto_total: custoPrevisto,
      datas_na_curva: parsed.data.curva.length,
      sem_desembolso: semDesembolso,
      faturamento_previsto: faturamentoPrevisto,
      parcelas_de_recebimento: parsed.data.recebimento.length,
      sem_recebimento: semRecebimento,
    },
  });

  revalidatePath("/financeiro");
  revalidatePath("/financeiro/abertura-de-job");
  revalidatePath(`/financeiro/abertura-de-job/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath(`/orcamentos/${job.projeto_id}/${job.orcamento_id}`);

  return { ok: true, id: jobId };
}
