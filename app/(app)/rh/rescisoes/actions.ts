"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient } from "@/lib/supabase/server";
import {
  calcularSnapshotRescisao,
  calcularTotalLiquido,
} from "@/lib/rh/calculo-rescisao";

type Result =
  | { ok: true; id?: string; message?: string }
  | { ok: false; message: string };

/**
 * Edita o ajuste manual (desconto de benefícios, outros descontos) da
 * rescisão em rascunho e recalcula o líquido. Só funciona enquanto
 * `status='rascunho'` — depois que foi ao financeiro, trava.
 */
export async function atualizarAjusteRescisao(input: {
  rescisao_id: string;
  ajuste_valor: number;
  ajuste_motivo: string | null;
}): Promise<Result> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  if (!Number.isFinite(input.ajuste_valor) || input.ajuste_valor < 0) {
    return { ok: false, message: "Valor de ajuste inválido." };
  }

  const supabase = createClient();

  const { data: resc, error: selErr } = await supabase
    .from("rescisoes")
    .select("id, status, total_bruto")
    .eq("id", input.rescisao_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (selErr || !resc) {
    return { ok: false, message: "Rescisão não encontrada." };
  }
  if (resc.status !== "rascunho") {
    return {
      ok: false,
      message: "Rescisão já enviada ao financeiro — não pode ser editada.",
    };
  }

  const totalBruto = Number(resc.total_bruto ?? 0);
  const totalLiquido = calcularTotalLiquido(totalBruto, input.ajuste_valor);

  const { error: updErr } = await supabase
    .from("rescisoes")
    .update({
      ajuste_valor: input.ajuste_valor,
      ajuste_motivo: input.ajuste_motivo?.trim() || null,
      total_liquido: totalLiquido,
      updated_by: session.profile.id,
    })
    .eq("id", input.rescisao_id);

  if (updErr) {
    console.error("[rh.rescisao.ajuste]", updErr.message);
    return { ok: false, message: "Falha ao salvar o ajuste." };
  }

  await logAuditEvent({
    acao: "rescisao.ajuste_editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "rescisao",
    entidadeId: input.rescisao_id,
    metadata: {
      ajuste_valor: input.ajuste_valor,
      total_liquido: totalLiquido,
    },
  });

  revalidatePath("/rh/rescisoes");
  return { ok: true };
}

/**
 * Recalcula o snapshot (salário vigente, avos, valores) a partir do
 * estado atual do colaborador. Usado quando o RH editou o salário
 * depois que a rescisão foi criada, ou quando a rescisão nasceu sem
 * salário (colaborador sem registro ativo em colaboradores_salarios).
 * Preserva o ajuste manual.
 */
export async function recalcularRescisao(
  rescisaoId: string,
): Promise<Result> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  const supabase = createClient();

  const { data: resc, error: selErr } = await supabase
    .from("rescisoes")
    .select(
      "id, status, colaborador_id, data_rescisao, ajuste_valor, colaborador:colaboradores!colaborador_id(data_admissao)",
    )
    .eq("id", rescisaoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (selErr || !resc) {
    return { ok: false, message: "Rescisão não encontrada." };
  }
  if (resc.status !== "rascunho") {
    return {
      ok: false,
      message: "Rescisão já enviada ao financeiro — não pode ser recalculada.",
    };
  }

  const colab = resc.colaborador as unknown as { data_admissao: string } | null;
  if (!colab?.data_admissao) {
    return { ok: false, message: "Data de admissão do colaborador não encontrada." };
  }

  const snapshot = await calcularSnapshotRescisao(
    supabase,
    resc.colaborador_id as string,
    colab.data_admissao,
    resc.data_rescisao as string,
  );

  if (!snapshot) {
    return {
      ok: false,
      message:
        "Colaborador sem salário vigente registrado. Cadastre o salário antes de recalcular.",
    };
  }

  const totalLiquido = calcularTotalLiquido(
    snapshot.total_bruto,
    Number(resc.ajuste_valor ?? 0),
  );

  const { error: updErr } = await supabase
    .from("rescisoes")
    .update({
      ...snapshot,
      total_liquido: totalLiquido,
      updated_by: session.profile.id,
    })
    .eq("id", rescisaoId);

  if (updErr) {
    console.error("[rh.rescisao.recalcular]", updErr.message);
    return { ok: false, message: "Falha ao recalcular." };
  }

  await logAuditEvent({
    acao: "rescisao.recalculada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "rescisao",
    entidadeId: rescisaoId,
    metadata: {
      total_bruto: snapshot.total_bruto,
      total_liquido: totalLiquido,
    },
  });

  revalidatePath("/rh/rescisoes");
  return { ok: true };
}

/**
 * Cria conta avulsa em Contas a Pagar (plano 05 Despesa com Pessoal /
 * subtipo 013 Rescisão), com data prevista de pagamento = hoje + 10
 * dias (padrão TRCT). Muda rescisão pra `enviada_financeiro` e grava
 * `conta_avulsa_id` no lookup inverso. Quando a avulsa for baixada, o
 * trigger `trg_conta_avulsa_propaga_rescisao` marca a rescisão como
 * `paga` sozinho.
 */
export async function enviarRescisaoAoFinanceiro(
  rescisaoId: string,
): Promise<Result> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: resc, error: selErr } = await supabase
    .from("rescisoes")
    .select(
      "id, status, colaborador_id, data_rescisao, total_liquido, colaborador:colaboradores!colaborador_id(nome)",
    )
    .eq("id", rescisaoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (selErr || !resc) {
    return { ok: false, message: "Rescisão não encontrada." };
  }
  if (resc.status !== "rascunho") {
    return { ok: false, message: "Rescisão já foi enviada." };
  }

  const totalLiquido = Number(resc.total_liquido ?? 0);
  if (totalLiquido <= 0) {
    return {
      ok: false,
      message: "Total líquido zero ou negativo. Recalcule antes de enviar.",
    };
  }

  // Alocação atual: usa como empresa/regional da avulsa. Rateios ficam
  // pra v2; no MVP o RH alinha com Contas a Pagar se precisar dividir.
  const { data: aloc } = await supabase
    .from("colaboradores_alocacoes")
    .select("empresa_id, regional_id")
    .eq("colaborador_id", resc.colaborador_id as string)
    .is("data_fim", null)
    .order("data_inicio", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!aloc?.empresa_id) {
    return {
      ok: false,
      message:
        "Colaborador sem alocação ativa — defina empresa antes de enviar.",
    };
  }

  // Plano 05.013 (Rescisão) do tenant.
  const { data: subtipo } = await supabase
    .from("plano_contas_subtipos")
    .select("id, tipo_id, tipo:plano_contas_tipos!tipo_id(id, codigo)")
    .eq("tenant_id", tenantId)
    .eq("codigo", "013")
    .maybeSingle();

  const tipo = (subtipo as unknown as { tipo: { id: string; codigo: string } } | null)?.tipo;
  if (!subtipo || !tipo || tipo.codigo !== "05") {
    return {
      ok: false,
      message:
        "Plano de contas 'Rescisão' (05.013) não configurado neste tenant.",
    };
  }

  const colabNome =
    (resc.colaborador as unknown as { nome: string } | null)?.nome ?? "—";

  const dataPrevista = new Date();
  dataPrevista.setDate(dataPrevista.getDate() + 10);
  const dataPrevistaISO = dataPrevista.toISOString().slice(0, 10);

  const { data: avulsa, error: avulsaErr } = await supabase
    .from("contas_avulsas")
    .insert({
      tenant_id: tenantId,
      empresa_id: aloc.empresa_id as string,
      regional_id: (aloc.regional_id as string | null) ?? null,
      colaborador_id: resc.colaborador_id as string,
      descricao: `Rescisão – ${colabNome}`,
      valor: totalLiquido,
      natureza: "saida",
      status: "aprovada",
      plano_conta_tipo_id: tipo.id,
      plano_conta_subtipo_id: subtipo.id,
      data_prevista_pagamento: dataPrevistaISO,
      criado_por: session.profile.id,
    })
    .select("id")
    .single();

  if (avulsaErr || !avulsa) {
    console.error("[rh.rescisao.enviar.avulsa]", avulsaErr?.message);
    return { ok: false, message: "Falha ao criar lançamento em Contas a Pagar." };
  }

  const { error: updErr } = await supabase
    .from("rescisoes")
    .update({
      status: "enviada_financeiro",
      conta_avulsa_id: avulsa.id,
      enviada_em: new Date().toISOString(),
      enviada_por: session.profile.id,
      updated_by: session.profile.id,
    })
    .eq("id", rescisaoId);

  if (updErr) {
    console.error("[rh.rescisao.enviar.update]", updErr.message);
    // Avulsa já foi criada — melhor deixar passar e deixar o RH reconciliar
    // manualmente do que travar o fluxo.
  }

  await logAuditEvent({
    acao: "rescisao.enviada_financeiro",
    tenantId,
    entidadeTipo: "rescisao",
    entidadeId: rescisaoId,
    metadata: {
      conta_avulsa_id: avulsa.id,
      total_liquido: totalLiquido,
      empresa_id: aloc.empresa_id,
    },
  });

  revalidatePath("/rh/rescisoes");
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id: avulsa.id };
}
