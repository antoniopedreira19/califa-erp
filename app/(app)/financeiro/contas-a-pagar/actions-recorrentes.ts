"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  criarContaRecorrenteSchema,
  editarContaRecorrenteSchema,
} from "@/lib/validations/conta-recorrente";

type Ok<T = { id: string }> = { ok: true } & Partial<T>;
type Err = { ok: false; message: string; fieldErrors?: Record<string, string[]> };
type Result<T = { id: string }> = Ok<T> | Err;

/**
 * Gate: apenas admin ou financeiro.
 * Duplicado de actions-avulsas.ts para evitar acoplamento entre módulos.
 * Adaptado para `entidadeTipo: "conta_recorrente"`.
 */
async function checarGateFinanceiro(
  entidadeId: string | null,
  acaoTentada: string,
): Promise<
  | {
      ok: true;
      session: Awaited<ReturnType<typeof requireSession>>;
      supabase: ReturnType<typeof createClient>;
    }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();

  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "conta_recorrente",
      entidadeId,
      metadata: {
        acao_tentada: acaoTentada,
        motivo: "sem_permissao_financeira",
      },
    });
    return {
      ok: false,
      message: "Apenas admin ou financeiro pode executar esta ação.",
    };
  }

  return { ok: true, session, supabase };
}

export async function criarContaRecorrente(input: unknown): Promise<Result> {
  const parsed = criarContaRecorrenteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const gate = await checarGateFinanceiro(null, "conta_recorrente.criada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const d = parsed.data;

  // Valida subtipo pertence ao tipo
  const { data: subtipo } = await supabase
    .from("plano_contas_subtipos")
    .select("tipo_id, ativo")
    .eq("id", d.plano_conta_subtipo_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!subtipo || subtipo.tipo_id !== d.plano_conta_tipo_id || !subtipo.ativo) {
    return {
      ok: false,
      message: "Subtipo inválido ou não pertence ao tipo escolhido.",
    };
  }

  // Calcula proxima_data inicial via RPC
  const { data: proxDataResult, error: rpcErr } = await supabase.rpc(
    "calcular_proxima_data_inicial",
    {
      p_frequencia: d.frequencia,
      p_dia_do_mes: d.dia_do_mes,
      p_dia_quinzena_1: d.dia_quinzena_1,
      p_dia_quinzena_2: d.dia_quinzena_2,
      p_dia_do_ano_dia: d.dia_do_ano_dia,
      p_dia_do_ano_mes: d.dia_do_ano_mes,
    },
  );

  if (rpcErr || !proxDataResult) {
    return {
      ok: false,
      message: `Falha ao calcular próxima data: ${rpcErr?.message ?? "erro desconhecido"}`,
    };
  }
  const proximaData = proxDataResult as string;

  // Se data_fim informada, valida ordem
  if (d.data_fim != null && proximaData > d.data_fim) {
    return {
      ok: false,
      message: "Data de fim é anterior à primeira ocorrência calculada.",
      fieldErrors: {
        data_fim: ["Data de fim deve ser posterior à primeira ocorrência."],
      },
    };
  }

  const { data: rec, error } = await supabase
    .from("contas_avulsas_recorrentes")
    .insert({
      tenant_id: session.activeTenant.id,
      empresa_id: d.empresa_id,
      descricao: d.descricao,
      valor: d.valor,
      fornecedor_id: d.fornecedor_id,
      cliente_id: d.cliente_id,
      job_id: d.job_id,
      plano_conta_tipo_id: d.plano_conta_tipo_id,
      plano_conta_subtipo_id: d.plano_conta_subtipo_id,
      frequencia: d.frequencia,
      dia_do_mes: d.dia_do_mes,
      dia_quinzena_1: d.dia_quinzena_1,
      dia_quinzena_2: d.dia_quinzena_2,
      dia_do_ano_dia: d.dia_do_ano_dia,
      dia_do_ano_mes: d.dia_do_ano_mes,
      proxima_data: proximaData,
      data_fim: d.data_fim,
      criado_por: session.profile.id,
    })
    .select("id")
    .single();

  if (error || !rec) {
    return {
      ok: false,
      message: `Falha ao criar recorrência: ${error?.message ?? "erro"}`,
    };
  }

  // Rateio regional
  let rateioFinal = d.rateio;
  if (d.job_id) {
    const { data: jobRow } = await supabase
      .from("jobs")
      .select("regional_id")
      .eq("id", d.job_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle();
    if (!jobRow?.regional_id) {
      await supabase
        .from("contas_avulsas_recorrentes")
        .delete()
        .eq("id", rec.id);
      return {
        ok: false,
        message: "Job selecionado não tem regional associada.",
      };
    }
    rateioFinal = [{ regional_id: jobRow.regional_id, percentual: 100 }];
  }

  const rateioRows = rateioFinal.map((r) => ({
    tenant_id: session.activeTenant.id,
    recorrente_id: rec.id,
    regional_id: r.regional_id,
    percentual: r.percentual,
  }));
  const { error: rateioErr } = await supabase
    .from("contas_avulsas_recorrentes_regionais")
    .insert(rateioRows);

  if (rateioErr) {
    await supabase
      .from("contas_avulsas_recorrentes")
      .delete()
      .eq("id", rec.id);
    return { ok: false, message: `Falha ao salvar rateio: ${rateioErr.message}` };
  }

  await logAuditEvent({
    acao: "conta_recorrente.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: rec.id,
    metadata: {
      descricao: d.descricao,
      valor: Number(d.valor),
      frequencia: d.frequencia,
      proxima_data: proximaData,
      data_fim: d.data_fim,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id: rec.id };
}

export async function editarContaRecorrente(
  id: string,
  input: unknown,
): Promise<Result> {
  const parsed = editarContaRecorrenteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const gate = await checarGateFinanceiro(id, "conta_recorrente.editada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;
  const d = parsed.data;

  const { data: atual } = await supabase
    .from("contas_avulsas_recorrentes")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!atual) return { ok: false, message: "Recorrência não encontrada." };
  if (!atual.ativo) {
    return {
      ok: false,
      message: "Só recorrências ativas podem ser editadas. Reative primeiro.",
    };
  }

  // Detecta mudança em cluster de frequência
  const mudouFrequencia =
    atual.frequencia !== d.frequencia ||
    atual.dia_do_mes !== d.dia_do_mes ||
    atual.dia_quinzena_1 !== d.dia_quinzena_1 ||
    atual.dia_quinzena_2 !== d.dia_quinzena_2 ||
    atual.dia_do_ano_dia !== d.dia_do_ano_dia ||
    atual.dia_do_ano_mes !== d.dia_do_ano_mes;

  let novaProxData: string | null = null;
  if (mudouFrequencia) {
    const { data: prox, error: rpcErr } = await supabase.rpc(
      "calcular_proxima_data_inicial",
      {
        p_frequencia: d.frequencia,
        p_dia_do_mes: d.dia_do_mes,
        p_dia_quinzena_1: d.dia_quinzena_1,
        p_dia_quinzena_2: d.dia_quinzena_2,
        p_dia_do_ano_dia: d.dia_do_ano_dia,
        p_dia_do_ano_mes: d.dia_do_ano_mes,
      },
    );
    if (rpcErr || !prox) {
      return {
        ok: false,
        message: `Falha ao recalcular próxima data: ${rpcErr?.message ?? "erro"}`,
      };
    }
    novaProxData = prox as string;
  }

  const patch: Record<string, unknown> = {
    descricao: d.descricao,
    valor: d.valor,
    fornecedor_id: d.fornecedor_id,
    cliente_id: d.cliente_id,
    job_id: d.job_id,
    plano_conta_tipo_id: d.plano_conta_tipo_id,
    plano_conta_subtipo_id: d.plano_conta_subtipo_id,
    frequencia: d.frequencia,
    dia_do_mes: d.dia_do_mes,
    dia_quinzena_1: d.dia_quinzena_1,
    dia_quinzena_2: d.dia_quinzena_2,
    dia_do_ano_dia: d.dia_do_ano_dia,
    dia_do_ano_mes: d.dia_do_ano_mes,
    data_fim: d.data_fim,
  };
  if (novaProxData !== null) patch.proxima_data = novaProxData;

  const { error } = await supabase
    .from("contas_avulsas_recorrentes")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) return { ok: false, message: `Falha ao atualizar: ${error.message}` };

  // Rateio regional: carrega atual, compara, substitui se mudou
  const { data: rateioAtual } = await supabase
    .from("contas_avulsas_recorrentes_regionais")
    .select("regional_id, percentual")
    .eq("recorrente_id", id)
    .eq("tenant_id", session.activeTenant.id);

  let rateioNovo = d.rateio;
  if (d.job_id) {
    const { data: jobRow } = await supabase
      .from("jobs")
      .select("regional_id")
      .eq("id", d.job_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle();
    if (!jobRow?.regional_id) {
      return {
        ok: false,
        message: "Job selecionado não tem regional associada.",
      };
    }
    rateioNovo = [{ regional_id: jobRow.regional_id, percentual: 100 }];
  }

  function normalizar(
    rows: Array<{ regional_id: string; percentual: number | string }>,
  ) {
    return rows
      .map((r) => `${r.regional_id}:${Number(r.percentual).toFixed(2)}`)
      .sort()
      .join("|");
  }
  const antesStr = normalizar(rateioAtual ?? []);
  const depoisStr = normalizar(rateioNovo);

  if (antesStr !== depoisStr) {
    const { error: delErr } = await supabase
      .from("contas_avulsas_recorrentes_regionais")
      .delete()
      .eq("recorrente_id", id)
      .eq("tenant_id", session.activeTenant.id);
    if (delErr)
      return { ok: false, message: `Falha ao apagar rateio: ${delErr.message}` };

    const novasRows = rateioNovo.map((r) => ({
      tenant_id: session.activeTenant.id,
      recorrente_id: id,
      regional_id: r.regional_id,
      percentual: r.percentual,
    }));
    const { error: insErr } = await supabase
      .from("contas_avulsas_recorrentes_regionais")
      .insert(novasRows);
    if (insErr) {
      // Compensação: restaura rateio anterior para não deixar a recorrência sem rateio.
      if ((rateioAtual ?? []).length > 0) {
        await supabase.from("contas_avulsas_recorrentes_regionais").insert(
          (rateioAtual ?? []).map((r) => ({
            tenant_id: session.activeTenant.id,
            recorrente_id: id,
            regional_id: r.regional_id,
            percentual: r.percentual,
          })),
        );
      }
      return { ok: false, message: `Falha ao salvar rateio: ${insErr.message}` };
    }

    await logAuditEvent({
      acao: "conta_recorrente.rateio_alterado",
      tenantId: session.activeTenant.id,
      entidadeTipo: "conta_recorrente",
      entidadeId: id,
      metadata: {
        linhas_anteriores: (rateioAtual ?? []).length,
        linhas_novas: rateioNovo.length,
      },
    });
  }

  await logAuditEvent({
    acao: "conta_recorrente.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: id,
    metadata: {
      mudou_frequencia: mudouFrequencia,
      nova_proxima_data: novaProxData,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath(`/financeiro/contas-a-pagar/recorrente/${id}`);
  return { ok: true, id };
}

export async function pausarContaRecorrente(id: string): Promise<Result> {
  const gate = await checarGateFinanceiro(id, "conta_recorrente.pausada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { error } = await supabase
    .from("contas_avulsas_recorrentes")
    .update({ ativo: false })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) return { ok: false, message: `Falha ao pausar: ${error.message}` };

  await logAuditEvent({
    acao: "conta_recorrente.pausada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: id,
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath(`/financeiro/contas-a-pagar/recorrente/${id}`);
  return { ok: true, id };
}

export async function reativarContaRecorrente(id: string): Promise<Result> {
  const gate = await checarGateFinanceiro(id, "conta_recorrente.reativada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: atual } = await supabase
    .from("contas_avulsas_recorrentes")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!atual) return { ok: false, message: "Recorrência não encontrada." };

  // Se proxima_data já passou, recalcula.
  const hoje = new Date().toISOString().slice(0, 10);
  let novaProxData: string | null = null;
  if (atual.proxima_data <= hoje) {
    const { data: prox } = await supabase.rpc("calcular_proxima_data_inicial", {
      p_frequencia: atual.frequencia,
      p_dia_do_mes: atual.dia_do_mes,
      p_dia_quinzena_1: atual.dia_quinzena_1,
      p_dia_quinzena_2: atual.dia_quinzena_2,
      p_dia_do_ano_dia: atual.dia_do_ano_dia,
      p_dia_do_ano_mes: atual.dia_do_ano_mes,
    });
    novaProxData = prox as string;
  }

  const patch: Record<string, unknown> = { ativo: true };
  if (novaProxData !== null) patch.proxima_data = novaProxData;

  const { error } = await supabase
    .from("contas_avulsas_recorrentes")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) return { ok: false, message: `Falha ao reativar: ${error.message}` };

  await logAuditEvent({
    acao: "conta_recorrente.reativada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: id,
    metadata: {
      recalculou_proxima_data: novaProxData !== null,
      proxima_data: novaProxData,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath(`/financeiro/contas-a-pagar/recorrente/${id}`);
  return { ok: true, id };
}

export async function excluirContaRecorrente(id: string): Promise<Result> {
  const gate = await checarGateFinanceiro(id, "conta_recorrente.excluida");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  // Conta instâncias já geradas
  const { count } = await supabase
    .from("contas_avulsas")
    .select("id", { count: "exact", head: true })
    .eq("recorrente_id", id);

  const geradas = count ?? 0;

  if (geradas === 0) {
    // Hard delete — nunca gerou nada.
    const { error } = await supabase
      .from("contas_avulsas_recorrentes")
      .delete()
      .eq("id", id)
      .eq("tenant_id", session.activeTenant.id);

    if (error) {
      return { ok: false, message: `Falha ao excluir: ${error.message}` };
    }
  } else {
    // Soft delete — mantém histórico das instâncias.
    const { error } = await supabase
      .from("contas_avulsas_recorrentes")
      .update({ ativo: false })
      .eq("id", id)
      .eq("tenant_id", session.activeTenant.id);

    if (error) {
      return { ok: false, message: `Falha ao pausar: ${error.message}` };
    }
  }

  await logAuditEvent({
    acao: "conta_recorrente.excluida",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_recorrente",
    entidadeId: id,
    metadata: { hard_delete: geradas === 0, instancias_geradas: geradas },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id };
}
