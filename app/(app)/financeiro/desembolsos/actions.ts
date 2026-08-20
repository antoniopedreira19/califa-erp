"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  criarDesembolsoSchema,
  aprovarDesembolsoSchema,
  rejeitarDesembolsoSchema,
  cancelarDesembolsoSchema,
} from "@/lib/validations/desembolso";

type Result = { ok: true; id?: string } | { ok: false; message: string };

function revalidarDesembolsos() {
  revalidatePath("/financeiro/desembolsos");
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-caixa");
}

async function checarGateFinanceiro(): Promise<
  | { ok: true; session: Awaited<ReturnType<typeof requireSession>>; supabase: ReturnType<typeof createClient> }
  | { ok: false; message: string }
> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: "Apenas admin ou financeiro pode executar esta ação." };
  }
  return { ok: true, session, supabase: createClient() };
}

export async function criarDesembolso(input: unknown): Promise<Result> {
  const parsed = criarDesembolsoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const d = parsed.data;

  const session = await requireSession();
  const supabase = createClient();

  // Gera código sequencial
  const { data: codigo, error: errCod } = await supabase.rpc("gerar_codigo_desembolso", {
    p_tenant_id: session.activeTenant.id,
  });
  if (errCod) return { ok: false, message: `Falha ao gerar código: ${errCod.message}` };

  // INSERT em desembolsos
  const { data: desembolso, error: errIns } = await supabase
    .from("desembolsos")
    .insert({
      tenant_id: session.activeTenant.id,
      codigo,
      empresa_id: d.empresa_id,
      descricao: d.descricao,
      valor: d.valor,
      forma_pagamento: d.forma_pagamento,
      cartao_credito_id: d.cartao_credito_id,
      fornecedor_id: d.fornecedor_id,
      cliente_id: d.cliente_id,
      job_id: d.job_id,
      data_prevista_pagamento: d.data_prevista_pagamento,
      criado_por: session.profile.id,
    })
    .select("id, codigo")
    .single();
  if (errIns) return { ok: false, message: `Falha ao criar desembolso: ${errIns.message}` };

  // INSERT em desembolsos_parcelas
  const parcelasPayload = d.parcelas.map((p) => ({
    tenant_id: session.activeTenant.id,
    desembolso_id: desembolso.id,
    numero: p.numero,
    data_vencimento: p.data_vencimento,
    valor: p.valor,
  }));
  const { error: errParc } = await supabase.from("desembolsos_parcelas").insert(parcelasPayload);
  if (errParc) return { ok: false, message: `Falha ao criar parcelas: ${errParc.message}` };

  // INSERT em desembolsos_regionais
  const rateioPayload = d.rateio.map((r) => ({
    desembolso_id: desembolso.id,
    regional_id: r.regional_id,
    percentual: r.percentual,
  }));
  const { error: errRat } = await supabase.from("desembolsos_regionais").insert(rateioPayload);
  if (errRat) return { ok: false, message: `Falha ao criar rateio: ${errRat.message}` };

  // INSERT em desembolsos_anexos (se houver)
  if (d.anexos.length > 0) {
    const anexosPayload = d.anexos.map((a) => ({
      tenant_id: session.activeTenant.id,
      desembolso_id: desembolso.id,
      arquivo_path: a.path,
      arquivo_nome_original: a.nome,
      arquivo_tamanho_bytes: a.tamanho,
      criado_por: session.profile.id,
    }));
    const { error: errAnx } = await supabase.from("desembolsos_anexos").insert(anexosPayload);
    if (errAnx) return { ok: false, message: `Falha ao anexar arquivos: ${errAnx.message}` };
  }

  await logAuditEvent({
    acao: "desembolso.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "desembolso",
    entidadeId: desembolso.id,
    metadata: {
      codigo: desembolso.codigo,
      valor: Number(d.valor),
      forma_pagamento: d.forma_pagamento,
      cartao_credito_id: d.cartao_credito_id,
      qtd_parcelas: d.parcelas.length,
    },
  });

  revalidarDesembolsos();
  return { ok: true, id: desembolso.id };
}

export async function aprovarDesembolsoComData(input: unknown): Promise<Result> {
  const parsed = aprovarDesembolsoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };

  const gate = await checarGateFinanceiro();
  if (!gate.ok) return gate;

  const { data: desembolso } = await gate.supabase
    .from("desembolsos")
    .select("id, codigo, valor, status")
    .eq("id", parsed.data.desembolso_id)
    .eq("tenant_id", gate.session.activeTenant.id)
    .maybeSingle();
  if (!desembolso) return { ok: false, message: "Desembolso não encontrado." };
  if (desembolso.status !== "em_avaliacao") {
    return { ok: false, message: "Só desembolso em avaliação pode ser aprovado." };
  }

  const { error } = await gate.supabase.rpc("aprovar_desembolso_com_data", {
    p_desembolso_id: parsed.data.desembolso_id,
    p_data_pagamento: parsed.data.data_pagamento,
  });
  if (error) return { ok: false, message: `Falha ao aprovar: ${error.message}` };

  await logAuditEvent({
    acao: "desembolso.aprovada",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "desembolso",
    entidadeId: desembolso.id,
    metadata: {
      codigo: desembolso.codigo,
      valor: Number(desembolso.valor),
      data_pagamento: parsed.data.data_pagamento,
    },
  });

  revalidarDesembolsos();
  return { ok: true };
}

export async function rejeitarDesembolso(input: unknown): Promise<Result> {
  const parsed = rejeitarDesembolsoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };

  const gate = await checarGateFinanceiro();
  if (!gate.ok) return gate;

  const { data: desembolso } = await gate.supabase
    .from("desembolsos")
    .select("id, codigo, status")
    .eq("id", parsed.data.desembolso_id)
    .eq("tenant_id", gate.session.activeTenant.id)
    .maybeSingle();
  if (!desembolso) return { ok: false, message: "Desembolso não encontrado." };
  if (desembolso.status !== "em_avaliacao") {
    return { ok: false, message: "Só desembolso em avaliação pode ser rejeitado." };
  }

  const { error } = await gate.supabase
    .from("desembolsos")
    .update({
      status: "rejeitada",
      motivo_rejeicao: parsed.data.motivo,
      rejeitada_por: gate.session.profile.id,
      rejeitada_em: new Date().toISOString(),
    })
    .eq("id", parsed.data.desembolso_id)
    .eq("tenant_id", gate.session.activeTenant.id);
  if (error) return { ok: false, message: `Falha ao rejeitar: ${error.message}` };

  await logAuditEvent({
    acao: "desembolso.rejeitada",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "desembolso",
    entidadeId: desembolso.id,
    metadata: { codigo: desembolso.codigo, motivo: parsed.data.motivo },
  });

  revalidarDesembolsos();
  return { ok: true };
}

export async function cancelarDesembolso(input: unknown): Promise<Result> {
  const parsed = cancelarDesembolsoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };

  const gate = await checarGateFinanceiro();
  if (!gate.ok) return gate;

  const { data: desembolso } = await gate.supabase
    .from("desembolsos")
    .select("id, codigo, status")
    .eq("id", parsed.data.desembolso_id)
    .eq("tenant_id", gate.session.activeTenant.id)
    .maybeSingle();
  if (!desembolso) return { ok: false, message: "Desembolso não encontrado." };
  if (!["em_avaliacao", "aprovada"].includes(desembolso.status)) {
    return { ok: false, message: "Só desembolso em avaliação ou aprovado pode ser cancelado." };
  }

  // Se aprovado, verificar que nenhuma parcela foi baixada
  if (desembolso.status === "aprovada") {
    const { count } = await gate.supabase
      .from("desembolsos_parcelas")
      .select("id", { count: "exact", head: true })
      .eq("desembolso_id", desembolso.id)
      .not("pago_em", "is", null);
    if ((count ?? 0) > 0) {
      return { ok: false, message: "Desembolso já tem parcelas pagas — não pode ser cancelado." };
    }
  }

  const { error } = await gate.supabase
    .from("desembolsos")
    .update({
      status: "cancelada",
      motivo_cancelamento: parsed.data.motivo,
      cancelada_por: gate.session.profile.id,
      cancelada_em: new Date().toISOString(),
    })
    .eq("id", parsed.data.desembolso_id)
    .eq("tenant_id", gate.session.activeTenant.id);
  if (error) return { ok: false, message: `Falha ao cancelar: ${error.message}` };

  await logAuditEvent({
    acao: "desembolso.cancelada",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "desembolso",
    entidadeId: desembolso.id,
    metadata: { codigo: desembolso.codigo, motivo: parsed.data.motivo, status_anterior: desembolso.status },
  });

  revalidarDesembolsos();
  return { ok: true };
}
