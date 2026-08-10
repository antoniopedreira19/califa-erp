"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  criarContaAvulsaSchema,
  editarContaAvulsaSchema,
  baixaAvulsaSchema,
  estornoAvulsaSchema,
} from "@/lib/validations/conta-avulsa";

type Ok<T = { id: string }> = { ok: true } & Partial<T>;
type Err = { ok: false; message: string; fieldErrors?: Record<string, string[]> };
type Result<T = { id: string }> = Ok<T> | Err;

/**
 * Gate: apenas admin ou financeiro.
 * Duplicado de actions.ts para evitar acoplamento entre módulos.
 * Adaptado para `entidadeTipo: "conta_avulsa"`.
 */
async function checarGateFinanceiro(
  contaAvulsaId: string | null,
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
      entidadeTipo: "conta_avulsa",
      entidadeId: contaAvulsaId,
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

export async function criarContaAvulsa(input: unknown): Promise<Result> {
  const parsed = criarContaAvulsaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const gate = await checarGateFinanceiro(null, "conta_avulsa.criada");
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

  const { data: conta, error } = await supabase
    .from("contas_avulsas")
    .insert({
      tenant_id: session.activeTenant.id,
      empresa_id: d.empresa_id,
      descricao: d.descricao,
      valor: d.valor,
      natureza: d.natureza,
      data_prevista_pagamento: d.data_prevista_pagamento,
      fornecedor_id: d.fornecedor_id,
      cliente_id: d.cliente_id,
      job_id: d.job_id,
      plano_conta_tipo_id: d.plano_conta_tipo_id,
      plano_conta_subtipo_id: d.plano_conta_subtipo_id,
      criado_por: session.profile.id,
    })
    .select("id")
    .single();

  if (error || !conta) {
    console.error("[avulsa.criar]", error?.message);
    return { ok: false, message: error?.message ?? "Falha ao criar conta avulsa." };
  }

  // Anexos em bulk
  if (d.anexos.length > 0) {
    const rows = d.anexos.map((a) => ({
      tenant_id: session.activeTenant.id,
      conta_avulsa_id: conta.id,
      arquivo_path: a.path,
      arquivo_nome_original: a.nome,
      arquivo_tamanho_bytes: a.tamanho,
      arquivo_mimetype: a.mimetype,
      created_by: session.profile.id,
    }));
    const { error: anexErr } = await supabase
      .from("contas_avulsas_anexos")
      .insert(rows);
    if (anexErr) {
      // Não aborta — conta criada, só perdeu anexos. Log e segue.
      console.error("[avulsa.criar.anexos]", anexErr.message);
    }
  }

  await logAuditEvent({
    acao: "conta_avulsa.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: conta.id,
    metadata: {
      descricao: d.descricao,
      valor: Number(d.valor),
      natureza: d.natureza,
      empresa_id: d.empresa_id,
      anexos_count: d.anexos.length,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id: conta.id };
}

export async function editarContaAvulsa(
  id: string,
  input: unknown,
): Promise<Result> {
  const parsed = editarContaAvulsaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const gate = await checarGateFinanceiro(id, "conta_avulsa.editada");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: atual } = await supabase
    .from("contas_avulsas")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!atual) return { ok: false, message: "Conta avulsa não encontrada." };
  if (atual.status !== "pendente") {
    return {
      ok: false,
      message:
        "Só conta pendente pode ser editada. Para alterar uma baixada, cancele a baixa antes.",
    };
  }

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

  // Compara campo a campo pra montar histórico
  const camposComparaveis = [
    "descricao",
    "valor",
    "natureza",
    "data_prevista_pagamento",
    "fornecedor_id",
    "cliente_id",
    "job_id",
    "plano_conta_tipo_id",
    "plano_conta_subtipo_id",
  ] as const;

  const historicoRows: Array<{
    tenant_id: string;
    conta_avulsa_id: string;
    campo_alterado: string;
    valor_anterior: string | null;
    valor_novo: string | null;
    alterado_por: string;
  }> = [];

  const camposAlterados: string[] = [];

  for (const campo of camposComparaveis) {
    const antes = atual[campo as keyof typeof atual] as unknown;
    const depois = d[campo as keyof typeof d] as unknown;
    // Normaliza null vs undefined vs "" pra comparação estável
    const antesStr = antes == null ? null : String(antes);
    const depoisStr = depois == null ? null : String(depois);
    if (antesStr !== depoisStr) {
      camposAlterados.push(campo);
      historicoRows.push({
        tenant_id: session.activeTenant.id,
        conta_avulsa_id: id,
        campo_alterado: campo,
        valor_anterior: antesStr,
        valor_novo: depoisStr,
        alterado_por: session.profile.id,
      });
    }
  }

  if (camposAlterados.length === 0) {
    // Nada mudou, retorna OK sem tocar em nada.
    return { ok: true, id };
  }

  // UPDATE
  const { error: updErr } = await supabase
    .from("contas_avulsas")
    .update({
      descricao: d.descricao,
      valor: d.valor,
      natureza: d.natureza,
      data_prevista_pagamento: d.data_prevista_pagamento,
      fornecedor_id: d.fornecedor_id,
      cliente_id: d.cliente_id,
      job_id: d.job_id,
      plano_conta_tipo_id: d.plano_conta_tipo_id,
      plano_conta_subtipo_id: d.plano_conta_subtipo_id,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (updErr) {
    return { ok: false, message: `Falha ao atualizar: ${updErr.message}` };
  }

  // INSERT histórico
  // Não é transacional entre chamadas do supabase-js — em caso de falha do
  // histórico, o UPDATE persiste. Aceitável: histórico é audit, não afeta lógica.
  if (historicoRows.length > 0) {
    const { error: histErr } = await supabase
      .from("contas_avulsas_historico")
      .insert(historicoRows);
    if (histErr) console.error("[avulsa.editar.historico]", histErr.message);
  }

  await logAuditEvent({
    acao: "conta_avulsa.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: id,
    metadata: { campos_alterados: camposAlterados },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath(`/financeiro/contas-a-pagar/avulsa/${id}`);
  return { ok: true, id };
}

export async function excluirContaAvulsa(id: string): Promise<Result> {
  const gate = await checarGateFinanceiro(id, "conta_avulsa.excluida");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: atual } = await supabase
    .from("contas_avulsas")
    .select("id, status, descricao, valor, natureza")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!atual) return { ok: false, message: "Conta avulsa não encontrada." };
  if (atual.status !== "pendente") {
    return {
      ok: false,
      message:
        "Baixa registrada. Para excluir, cancele a baixa antes.",
    };
  }

  // Carrega anexos pra deletar do storage antes do row cascade
  const { data: anexos } = await supabase
    .from("contas_avulsas_anexos")
    .select("arquivo_path")
    .eq("conta_avulsa_id", id);

  if (anexos && anexos.length > 0) {
    const paths = anexos.map((a) => a.arquivo_path);
    const { error: rmErr } = await supabase.storage
      .from("contas-avulsas")
      .remove(paths);
    if (rmErr) console.error("[avulsa.excluir.storage]", rmErr.message);
  }

  const { error } = await supabase
    .from("contas_avulsas")
    .delete()
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) return { ok: false, message: `Falha ao excluir: ${error.message}` };

  await logAuditEvent({
    acao: "conta_avulsa.excluida",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: id,
    metadata: {
      descricao: atual.descricao,
      valor: Number(atual.valor),
      natureza: atual.natureza,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id };
}

export async function darBaixaAvulsa(input: unknown): Promise<Result> {
  const parsed = baixaAvulsaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Entrada inválida.",
    };
  }
  const gate = await checarGateFinanceiro(
    parsed.data.conta_avulsa_id,
    "conta_avulsa.baixada",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: atual } = await supabase
    .from("contas_avulsas")
    .select("id, status, descricao, valor, natureza")
    .eq("id", parsed.data.conta_avulsa_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!atual) return { ok: false, message: "Conta avulsa não encontrada." };
  if (atual.status !== "pendente") {
    return { ok: false, message: "Conta avulsa não está pendente." };
  }

  const { data: lancId, error } = await supabase.rpc("dar_baixa_avulsa", {
    p_conta_avulsa_id: parsed.data.conta_avulsa_id,
    p_pago_em: parsed.data.pago_em,
    p_conta_bancaria_id: parsed.data.conta_bancaria_id,
  });

  if (error) return { ok: false, message: `Falha ao dar baixa: ${error.message}` };

  await logAuditEvent({
    acao: "conta_avulsa.baixada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: parsed.data.conta_avulsa_id,
    metadata: {
      descricao: atual.descricao,
      valor: Number(atual.valor),
      pago_em: parsed.data.pago_em,
      conta_bancaria_id: parsed.data.conta_bancaria_id,
      lancamento_id: lancId,
    },
  });
  await logAuditEvent({
    acao: "lancamento_financeiro.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "lancamento_financeiro",
    entidadeId: lancId as string,
    metadata: {
      origem: "avulsa_baixa",
      conta_avulsa_id: parsed.data.conta_avulsa_id,
      valor: Number(atual.valor),
      natureza: atual.natureza,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath(
    `/financeiro/contas-a-pagar/avulsa/${parsed.data.conta_avulsa_id}`,
  );
  return { ok: true, id: parsed.data.conta_avulsa_id };
}

export async function estornarBaixaAvulsa(input: unknown): Promise<Result> {
  const parsed = estornoAvulsaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Entrada inválida.",
    };
  }
  const gate = await checarGateFinanceiro(
    parsed.data.conta_avulsa_id,
    "conta_avulsa.baixa_estornada",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: atual } = await supabase
    .from("contas_avulsas")
    .select("id, status, descricao")
    .eq("id", parsed.data.conta_avulsa_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!atual) return { ok: false, message: "Conta avulsa não encontrada." };
  if (atual.status !== "baixada") {
    return {
      ok: false,
      message: "Só conta baixada pode ter a baixa estornada.",
    };
  }

  const { data: reversoId, error } = await supabase.rpc(
    "estornar_baixa_avulsa",
    {
      p_conta_avulsa_id: parsed.data.conta_avulsa_id,
      p_motivo: parsed.data.motivo,
    },
  );

  if (error) return { ok: false, message: `Falha ao estornar: ${error.message}` };

  await logAuditEvent({
    acao: "conta_avulsa.baixa_estornada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: parsed.data.conta_avulsa_id,
    metadata: {
      descricao: atual.descricao,
      motivo: parsed.data.motivo,
      lancamento_reverso_id: reversoId,
    },
  });
  await logAuditEvent({
    acao: "lancamento_financeiro.estornado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "lancamento_financeiro",
    entidadeId: reversoId as string,
    metadata: {
      origem: "avulsa_estorno",
      conta_avulsa_id: parsed.data.conta_avulsa_id,
      motivo: parsed.data.motivo,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath(
    `/financeiro/contas-a-pagar/avulsa/${parsed.data.conta_avulsa_id}`,
  );
  return { ok: true, id: parsed.data.conta_avulsa_id };
}

export async function signedUrlAnexoAvulsa(
  anexoId: string,
): Promise<{ ok: true; url: string } | Err> {
  const gate = await checarGateFinanceiro(null, "conta_avulsa_anexo.signed_url");
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: anexo } = await supabase
    .from("contas_avulsas_anexos")
    .select("arquivo_path, tenant_id")
    .eq("id", anexoId)
    .maybeSingle();

  if (!anexo || anexo.tenant_id !== session.activeTenant.id) {
    return { ok: false, message: "Anexo não encontrado." };
  }

  const { data, error } = await supabase.storage
    .from("contas-avulsas")
    .createSignedUrl(anexo.arquivo_path, 60);

  if (error || !data) return { ok: false, message: "Falha ao gerar URL." };
  return { ok: true, url: data.signedUrl };
}
