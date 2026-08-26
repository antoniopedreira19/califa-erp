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
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  calcularTotaisVersao,
  type ItemParaTotais,
} from "@/lib/calculos/versao-totais";
import type { TipoCusto } from "@/lib/types";

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string };

const dinheiro = (n: number) => Number(n.toFixed(2));

interface ItemDoJob {
  id: string;
  item: string;
  tipo_custo: TipoCusto;
  total_orcado: number;
  valor_unitario_orcado: number;
  em_save: boolean;
  save_consumido: number;
  grupo_id: string;
}

/** A mudança que a errata vai registrar. Exatamente uma das duas. */
export type MudancaDeSave =
  | { tipo: "marcar"; emSave: boolean }
  | { tipo: "consumo"; origens: { jobOrigemId: string; valor: number }[] };

/**
 * Aplica uma mudança de save num item do job, registrando a errata.
 *
 * A ordem importa: a errata é gravada ANTES de o orçado mudar, como em
 * `registrarErrata` — se a aplicação falhar, sobra um registro de algo
 * que não aconteceu, e é melhor do que a alteração sem histórico.
 */
export async function registrarErrataDeSave(
  jobId: string,
  jobItemOrcadoId: string,
  mudanca: MudancaDeSave,
  justificativa?: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // ---- job, versão aprovada e os itens do orçado ----
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select(
      "id, status, versao:versoes_orcamento!jobs_versao_orcamento_aprovada_id_fkey(percentual_honorarios, percentual_imposto)",
    )
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      status: string;
      versao: { percentual_honorarios: number; percentual_imposto: number } | null;
    }>();

  if (jobErr || !job) {
    console.error("[save.errata.job]", jobErr?.message);
    return { ok: false, message: "Job não encontrado." };
  }
  if (job.status === "encerrado") {
    return {
      ok: false,
      message: "Job encerrado não aceita errata: os números dele estão congelados.",
    };
  }

  const pctHonorarios = Number(job.versao?.percentual_honorarios ?? 0);
  const pctImposto = Number(job.versao?.percentual_imposto ?? 0);

  const [itensRes, grupoRes] = await Promise.all([
    supabase
      .from("jobs_itens_orcado")
      .select(
        "id, item, tipo_custo, total_orcado, valor_unitario_orcado, em_save, save_consumido, grupo_id",
      )
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId),
    supabase
      .from("versoes_orcamento_grupos")
      .select("id, nome")
      .eq("tenant_id", tenantId),
  ]);

  if (itensRes.error || !itensRes.data) {
    console.error("[save.errata.itens]", itensRes.error?.message);
    return { ok: false, message: "Não foi possível ler o orçado do job." };
  }

  const itens = itensRes.data as unknown as ItemDoJob[];
  const alvo = itens.find((i) => i.id === jobItemOrcadoId);
  if (!alvo) return { ok: false, message: "Linha não encontrada neste job." };

  const totalConsumo =
    mudanca.tipo === "consumo"
      ? mudanca.origens.reduce((s, o) => s + Number(o.valor || 0), 0)
      : 0;

  if (mudanca.tipo === "marcar" && mudanca.emSave && alvo.save_consumido > 0) {
    return {
      ok: false,
      message:
        "Esta linha é paga por saldo de save de outro job. Remova o consumo antes de transformá-la em save.",
    };
  }
  if (mudanca.tipo === "consumo" && alvo.em_save) {
    return {
      ok: false,
      message:
        "Uma linha não pode gerar e consumir save ao mesmo tempo. Desmarque o save desta linha primeiro.",
    };
  }
  if (totalConsumo > Number(alvo.total_orcado ?? 0) + 0.005) {
    return {
      ok: false,
      message: "O consumo de save não pode passar do orçado da linha.",
    };
  }

  // ---- os dois fechamentos, pela mesma função do card de Totais ----
  const paraTotais = (i: ItemDoJob, aplicar: boolean): ItemParaTotais => {
    if (!aplicar || i.id !== jobItemOrcadoId) {
      return {
        tipo_custo: i.tipo_custo,
        total_orcado: Number(i.total_orcado ?? 0),
        em_save: i.em_save,
        save_consumido: Number(i.save_consumido ?? 0),
      };
    }
    return {
      tipo_custo: i.tipo_custo,
      total_orcado: Number(i.total_orcado ?? 0),
      em_save: mudanca.tipo === "marcar" ? mudanca.emSave : false,
      save_consumido: mudanca.tipo === "consumo" ? totalConsumo : 0,
    };
  };

  const antes = calcularTotaisVersao(
    itens.map((i) => paraTotais(i, false)),
    pctHonorarios,
    pctImposto,
  );
  const depois = calcularTotaisVersao(
    itens.map((i) => paraTotais(i, true)),
    pctHonorarios,
    pctImposto,
  );

  // Nada mudou de verdade: não vale um registro no histórico.
  const mexeu =
    Math.abs(antes.valorJob - depois.valorJob) > 0.005 ||
    Math.abs(antes.faturamentoPrevisto - depois.faturamentoPrevisto) > 0.005;
  if (!mexeu) {
    return {
      ok: false,
      message: "Esta mudança não altera o valor do job nem o faturamento.",
    };
  }

  const nomeDoGrupo =
    ((grupoRes.data ?? []) as any[]).find((g) => g.id === alvo.grupo_id)?.nome ??
    "—";

  const titulo =
    mudanca.tipo === "marcar"
      ? mudanca.emSave
        ? `Save: "${alvo.item}" vira crédito`
        : `Save: "${alvo.item}" deixa de ser crédito`
      : totalConsumo > 0
        ? `Save: "${alvo.item}" passa a ser paga por saldo de outro job`
        : `Save: "${alvo.item}" deixa de consumir saldo`;

  // ---- errata primeiro, orçado depois ----
  const { data: errata, error: errataErr } = await supabase
    .from("jobs_erratas")
    .insert({
      tenant_id: tenantId,
      job_id: jobId,
      titulo,
      justificativa: justificativa?.trim() || null,
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
    console.error("[save.errata.insert]", errataErr?.message);
    return { ok: false, message: "Falha ao registrar a errata." };
  }

  const { error: itemErr } = await supabase.from("jobs_erratas_itens").insert({
    tenant_id: tenantId,
    errata_id: errata.id,
    job_item_orcado_id: alvo.id,
    item_nome: alvo.item,
    grupo_nome: nomeDoGrupo,
    // Tipo e unitário não mudam numa errata de save: a linha é a mesma, o
    // que muda é de qual lado da conta ela entra. As quatro colunas são
    // NOT NULL, então repetem o valor atual dos dois lados.
    tipo_custo_de: alvo.tipo_custo,
    tipo_custo_para: alvo.tipo_custo,
    valor_unitario_de: Number(alvo.valor_unitario_orcado ?? 0),
    valor_unitario_para: Number(alvo.valor_unitario_orcado ?? 0),
    total_de: dinheiro(Number(alvo.total_orcado ?? 0)),
    total_para: dinheiro(Number(alvo.total_orcado ?? 0)),
    efeito_valor_job: dinheiro(depois.valorJob - antes.valorJob),
    efeito_faturamento_previsto: dinheiro(
      depois.faturamentoPrevisto - antes.faturamentoPrevisto,
    ),
  });

  if (itemErr) {
    await supabase.from("jobs_erratas").delete().eq("id", errata.id);
    console.error("[save.errata.item]", itemErr.message);
    return { ok: false, message: "Falha ao registrar o item da errata." };
  }

  // ---- aplica ----
  if (mudanca.tipo === "marcar") {
    const { error } = await supabase
      .from("jobs_itens_orcado")
      .update({ em_save: mudanca.emSave })
      .eq("id", jobItemOrcadoId)
      .eq("tenant_id", tenantId);
    if (error) {
      console.error("[save.errata.marcar]", error.message);
      return { ok: false, message: "Falha ao aplicar o save na linha." };
    }
  } else {
    const { error: delErr } = await supabase
      .from("saves_consumos")
      .delete()
      .eq("job_item_orcado_id", jobItemOrcadoId)
      .eq("tenant_id", tenantId);
    if (delErr) {
      console.error("[save.errata.limpar]", delErr.message);
      return { ok: false, message: "Falha ao atualizar o consumo." };
    }
    const validas = mudanca.origens.filter((o) => Number(o.valor) > 0);
    if (validas.length > 0) {
      const { error: insErr } = await supabase.from("saves_consumos").insert(
        validas.map((o) => ({
          tenant_id: tenantId,
          job_origem_id: o.jobOrigemId,
          job_item_orcado_id: jobItemOrcadoId,
          valor: Number(o.valor),
          created_by: session.profile.id ?? null,
        })),
      );
      if (insErr) {
        console.error("[save.errata.consumo]", insErr.message);
        // A mensagem do trigger nomeia o job e os valores — melhor do que
        // qualquer genérica daqui.
        return { ok: false, message: insErr.message };
      }
    }
  }

  await supabase
    .from("jobs")
    .update({
      valor_total: dinheiro(depois.valorJob),
      faturamento_previsto: dinheiro(depois.faturamentoPrevisto),
    })
    .eq("id", jobId)
    .eq("tenant_id", tenantId);

  await logAuditEvent({
    acao: "job.errata_registrada",
    tenantId,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      errata_id: errata.id,
      titulo,
      origem: "save",
      valor_job_antes: antes.valorJob,
      valor_job_depois: depois.valorJob,
      faturamento_previsto_antes: antes.faturamentoPrevisto,
      faturamento_previsto_depois: depois.faturamentoPrevisto,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
