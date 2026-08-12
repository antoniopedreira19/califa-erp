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
import type { JobStatus } from "@/lib/types";
import { emCentavos, somaCurva } from "./curva";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Abre o job no financeiro: grava o registro contábil (nome financeiro,
 * categoria, competência, custo previsto e curva de desembolso) e só
 * então muda o status para `aberto`.
 *
 * O custo previsto NÃO vem do formulário. É relido de
 * `jobs_itens_orcado` aqui dentro: é dinheiro, e o navegador não é fonte
 * confiável para ele. A curva enviada é conferida contra esse valor.
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
    .select("id, status, projeto_id, orcamento_id")
    .eq("id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      status: JobStatus;
      projeto_id: string;
      orcamento_id: string;
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
    .select("total_planejado")
    .eq("job_id", jobId)
    .eq("tenant_id", session.activeTenant.id);

  if (itensErro) {
    console.error("[abertura-job.planejado]", itensErro.message);
    return { ok: false, message: "Não foi possível ler a planilha do job." };
  }

  const custoPrevisto = emCentavos(
    (itens ?? []).reduce(
      (s, i: { total_planejado: number | string | null }) =>
        s + Number(i.total_planejado ?? 0),
      0,
    ),
  );

  if (custoPrevisto <= 0) {
    return {
      ok: false,
      message:
        "A planilha interna deste job está sem custo planejado. Ajuste o orçamento antes de abrir.",
    };
  }

  const soma = somaCurva(parsed.data.curva);
  if (Math.abs(soma - custoPrevisto) >= TOLERANCIA_CURVA) {
    return {
      ok: false,
      message: `A curva de desembolso soma ${soma.toFixed(2)} e o custo previsto é ${custoPrevisto.toFixed(2)}. Ajuste as datas antes de abrir.`,
    };
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

  // A curva é regravada inteira: apaga o que houver e insere de novo.
  // Na abertura não há nada para apagar, mas a edição futura da curva
  // usa o mesmo caminho.
  const { error: deleteErro } = await supabase
    .from("jobs_previsao_custo")
    .delete()
    .eq("job_id", jobId)
    .eq("tenant_id", session.activeTenant.id);

  if (deleteErro) {
    console.error("[abertura-job.curva-delete]", deleteErro.message);
  }

  const { error: curvaErro } = await supabase.from("jobs_previsao_custo").insert(
    parsed.data.curva.map((linha, i) => ({
      tenant_id: session.activeTenant.id,
      job_id: jobId,
      ordem: i + 1,
      data_prevista: linha.data_prevista,
      valor: linha.valor,
      created_by: session.profile.id,
    })),
  );

  if (curvaErro) {
    // O job já está aberto e o registro contábil gravado. Voltar o status
    // aqui seria pior: o financeiro veria o job sumir da fila e reaparecer.
    // Melhor abrir com a curva vazia e deixar o alerta explícito.
    console.error("[abertura-job.curva-insert]", curvaErro.message);
    await logAuditEvent({
      acao: "job.aberto_no_financeiro",
      tenantId: session.activeTenant.id,
      entidadeTipo: "job",
      entidadeId: jobId,
      metadata: { curva_falhou: true, erro: curvaErro.message },
    });
    return {
      ok: false,
      message:
        "O job foi aberto, mas a curva de desembolso não foi gravada. Registre as datas na página do job.",
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
