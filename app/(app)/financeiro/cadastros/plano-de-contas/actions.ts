"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import { tipoSchema, subtipoSchema } from "@/lib/validations/plano-contas";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const ROLES_PERMITIDOS = ["administrador", "financeiro"] as const;

function temPermissao(role: string): boolean {
  return (ROLES_PERMITIDOS as readonly string[]).includes(role);
}

// ---------- helpers ----------

function mapTipoDbError(msg: string): string {
  if (msg.includes("uniq_tipo_codigo_por_tenant")) {
    return "Já existe um tipo com esse código.";
  }
  if (msg.includes("chk_tipo_codigo_formato")) {
    return "Código deve ter 2 dígitos (ex.: 01, 15).";
  }
  return "Não foi possível salvar o tipo.";
}

function mapSubtipoDbError(msg: string): string {
  if (msg.includes("uniq_subtipo_codigo_por_tipo")) {
    return "Já existe um subtipo com esse código neste tipo.";
  }
  if (msg.includes("uniq_subtipo_nome_por_tipo")) {
    return "Já existe um subtipo com esse nome neste tipo.";
  }
  if (msg.includes("chk_subtipo_codigo_formato")) {
    return "Código deve ter 3 dígitos (ex.: 001, 015).";
  }
  return "Não foi possível salvar o subtipo.";
}

// ---------- TIPOS ----------

export async function criarTipo(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();

  if (!temPermissao(session.activeRole)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      metadata: { acao_tentada: "plano_conta_tipo.criado" },
    });
    return { ok: false, message: "Sem permissão." };
  }

  const parsed = tipoSchema.safeParse({
    codigo: formData.get("codigo")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
    natureza_padrao: formData.get("natureza_padrao")?.toString() ?? "",
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const d = parsed.data;
  const supabase = createClient();

  const { data, error } = await supabase
    .from("plano_contas_tipos")
    .insert({
      tenant_id: session.activeTenant.id,
      codigo: d.codigo,
      nome: d.nome,
      natureza_padrao: d.natureza_padrao,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[plano_contas_tipos.criar]", error.message);
    return { ok: false, message: mapTipoDbError(error.message) };
  }

  await logAuditEvent({
    acao: "plano_conta_tipo.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "plano_conta_tipo",
    entidadeId: data.id,
    metadata: { codigo: d.codigo, nome: d.nome },
  });

  revalidatePath("/financeiro/cadastros/plano-de-contas");
  revalidatePath("/cadastros");
  return { ok: true, id: data.id };
}

export async function atualizarTipo(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();

  if (!temPermissao(session.activeRole)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      metadata: { acao_tentada: "plano_conta_tipo.atualizado" },
    });
    return { ok: false, message: "Sem permissão." };
  }

  const parsed = tipoSchema.safeParse({
    codigo: formData.get("codigo")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
    natureza_padrao: formData.get("natureza_padrao")?.toString() ?? "",
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const d = parsed.data;
  const supabase = createClient();

  // Buscar tipo atual para comparar código
  const { data: atual } = await supabase
    .from("plano_contas_tipos")
    .select("codigo")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .single();

  if (!atual) return { ok: false, message: "Tipo não encontrado." };

  // Se código mudou, checar se já há lançamento usando este tipo
  if (atual.codigo !== d.codigo) {
    let temLancamento = false;
    try {
      const { count, error: countError } = await supabase
        .from("lancamentos_financeiros")
        .select("*", { count: "exact", head: true })
        .eq("plano_conta_tipo_id", id);
      if (!countError) temLancamento = (count ?? 0) > 0;
    } catch (_) {
      // Tabela ainda não existe — tratar como sem lançamento
    }

    if (temLancamento) {
      return {
        ok: false,
        message: "Não é possível alterar o código.",
        fieldErrors: {
          codigo: [
            "Código já foi usado em lançamento e não pode ser alterado. Crie um tipo novo e inative este.",
          ],
        },
      };
    }
  }

  const { error } = await supabase
    .from("plano_contas_tipos")
    .update({
      codigo: d.codigo,
      nome: d.nome,
      natureza_padrao: d.natureza_padrao,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[plano_contas_tipos.atualizar]", error.message);
    return { ok: false, message: mapTipoDbError(error.message) };
  }

  await logAuditEvent({
    acao: "plano_conta_tipo.atualizado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "plano_conta_tipo",
    entidadeId: id,
    metadata: { codigo: d.codigo, nome: d.nome },
  });

  revalidatePath("/financeiro/cadastros/plano-de-contas");
  return { ok: true, id };
}

export async function inativarTipo(id: string): Promise<ActionResult> {
  const session = await requireSession();

  if (!temPermissao(session.activeRole)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      metadata: { acao_tentada: "plano_conta_tipo.inativado" },
    });
    return { ok: false, message: "Sem permissão." };
  }

  const supabase = createClient();

  // Bloquear se há subtipos ativos
  const { count: subtiposAtivos, error: subErr } = await supabase
    .from("plano_contas_subtipos")
    .select("*", { count: "exact", head: true })
    .eq("tipo_id", id)
    .eq("ativo", true);

  if (!subErr && (subtiposAtivos ?? 0) > 0) {
    return {
      ok: false,
      message:
        "Existem subtipos ativos ligados a este tipo. Inative-os primeiro.",
    };
  }

  // Bloquear se há lançamentos nos últimos 90 dias
  try {
    const noventaDiasAtras = new Date();
    noventaDiasAtras.setDate(noventaDiasAtras.getDate() - 90);
    const dataCorte = noventaDiasAtras.toISOString().slice(0, 10);

    const { count, error: countError } = await supabase
      .from("lancamentos_financeiros")
      .select("*", { count: "exact", head: true })
      .eq("plano_conta_tipo_id", id)
      .gte("data_movimento", dataCorte);

    if (!countError && (count ?? 0) > 0) {
      return {
        ok: false,
        message:
          "Este tipo tem lançamento nos últimos 90 dias. Não pode ser inativado.",
      };
    }
  } catch (_) {
    // Tabela ainda não existe — tratar como sem lançamento
  }

  const { data: tipoInfo } = await supabase
    .from("plano_contas_tipos")
    .select("codigo, nome")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .single();

  if (!tipoInfo) return { ok: false, message: "Tipo não encontrado." };

  const { error } = await supabase
    .from("plano_contas_tipos")
    .update({ ativo: false })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[plano_contas_tipos.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar o tipo." };
  }

  await logAuditEvent({
    acao: "plano_conta_tipo.inativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "plano_conta_tipo",
    entidadeId: id,
    metadata: { codigo: tipoInfo.codigo, nome: tipoInfo.nome },
  });

  revalidatePath("/financeiro/cadastros/plano-de-contas");
  revalidatePath("/cadastros");
  return { ok: true, id };
}

export async function reativarTipo(id: string): Promise<ActionResult> {
  const session = await requireSession();

  if (!temPermissao(session.activeRole)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      metadata: { acao_tentada: "plano_conta_tipo.reativado" },
    });
    return { ok: false, message: "Sem permissão." };
  }

  const supabase = createClient();

  const { data: tipoInfo } = await supabase
    .from("plano_contas_tipos")
    .select("codigo, nome")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .single();

  if (!tipoInfo) return { ok: false, message: "Tipo não encontrado." };

  const { error } = await supabase
    .from("plano_contas_tipos")
    .update({ ativo: true })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[plano_contas_tipos.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar o tipo." };
  }

  await logAuditEvent({
    acao: "plano_conta_tipo.reativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "plano_conta_tipo",
    entidadeId: id,
    metadata: { codigo: tipoInfo.codigo, nome: tipoInfo.nome },
  });

  revalidatePath("/financeiro/cadastros/plano-de-contas");
  revalidatePath("/cadastros");
  return { ok: true, id };
}

// ---------- SUBTIPOS ----------

export async function criarSubtipo(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();

  if (!temPermissao(session.activeRole)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      metadata: { acao_tentada: "plano_conta_subtipo.criado" },
    });
    return { ok: false, message: "Sem permissão." };
  }

  const parsed = subtipoSchema.safeParse({
    tipo_id: formData.get("tipo_id")?.toString() ?? "",
    codigo: formData.get("codigo")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const d = parsed.data;
  const supabase = createClient();

  const { data, error } = await supabase
    .from("plano_contas_subtipos")
    .insert({
      tenant_id: session.activeTenant.id,
      tipo_id: d.tipo_id,
      codigo: d.codigo,
      nome: d.nome,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[plano_contas_subtipos.criar]", error.message);
    return { ok: false, message: mapSubtipoDbError(error.message) };
  }

  await logAuditEvent({
    acao: "plano_conta_subtipo.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "plano_conta_subtipo",
    entidadeId: data.id,
    metadata: { tipo_id: d.tipo_id, codigo: d.codigo, nome: d.nome },
  });

  revalidatePath("/financeiro/cadastros/plano-de-contas");
  return { ok: true, id: data.id };
}

export async function atualizarSubtipo(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();

  if (!temPermissao(session.activeRole)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      metadata: { acao_tentada: "plano_conta_subtipo.atualizado" },
    });
    return { ok: false, message: "Sem permissão." };
  }

  const parsed = subtipoSchema.safeParse({
    tipo_id: formData.get("tipo_id")?.toString() ?? "",
    codigo: formData.get("codigo")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const d = parsed.data;
  const supabase = createClient();

  // Se código mudou, bloquear se há lançamento
  const { data: atual } = await supabase
    .from("plano_contas_subtipos")
    .select("codigo")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .single();

  if (!atual) return { ok: false, message: "Subtipo não encontrado." };

  if (atual.codigo !== d.codigo) {
    let temLancamento = false;
    try {
      const { count, error: countError } = await supabase
        .from("lancamentos_financeiros")
        .select("*", { count: "exact", head: true })
        .eq("plano_conta_subtipo_id", id);
      if (!countError) temLancamento = (count ?? 0) > 0;
    } catch (_) {
      // Tabela pode não existir ainda
    }

    if (temLancamento) {
      return {
        ok: false,
        message: "Não é possível alterar o código.",
        fieldErrors: {
          codigo: [
            "Código já foi usado em lançamento e não pode ser alterado. Crie um subtipo novo e inative este.",
          ],
        },
      };
    }
  }

  const { error } = await supabase
    .from("plano_contas_subtipos")
    .update({
      tipo_id: d.tipo_id,
      codigo: d.codigo,
      nome: d.nome,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[plano_contas_subtipos.atualizar]", error.message);
    return { ok: false, message: mapSubtipoDbError(error.message) };
  }

  await logAuditEvent({
    acao: "plano_conta_subtipo.atualizado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "plano_conta_subtipo",
    entidadeId: id,
    metadata: { tipo_id: d.tipo_id, codigo: d.codigo, nome: d.nome },
  });

  revalidatePath("/financeiro/cadastros/plano-de-contas");
  return { ok: true, id };
}

export async function inativarSubtipo(id: string): Promise<ActionResult> {
  const session = await requireSession();

  if (!temPermissao(session.activeRole)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      metadata: { acao_tentada: "plano_conta_subtipo.inativado" },
    });
    return { ok: false, message: "Sem permissão." };
  }

  const supabase = createClient();

  // Bloquear se há lançamentos nos últimos 90 dias
  try {
    const noventaDiasAtras = new Date();
    noventaDiasAtras.setDate(noventaDiasAtras.getDate() - 90);
    const dataCorte = noventaDiasAtras.toISOString().slice(0, 10);

    const { count, error: countError } = await supabase
      .from("lancamentos_financeiros")
      .select("*", { count: "exact", head: true })
      .eq("plano_conta_subtipo_id", id)
      .gte("data_movimento", dataCorte);

    if (!countError && (count ?? 0) > 0) {
      return {
        ok: false,
        message:
          "Este subtipo tem lançamento nos últimos 90 dias. Não pode ser inativado.",
      };
    }
  } catch (_) {
    // Tabela pode não existir ainda
  }

  const { data: subtipoInfo } = await supabase
    .from("plano_contas_subtipos")
    .select("codigo, nome, tipo_id")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .single();

  if (!subtipoInfo) return { ok: false, message: "Subtipo não encontrado." };

  const { error } = await supabase
    .from("plano_contas_subtipos")
    .update({ ativo: false })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[plano_contas_subtipos.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar o subtipo." };
  }

  await logAuditEvent({
    acao: "plano_conta_subtipo.inativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "plano_conta_subtipo",
    entidadeId: id,
    metadata: {
      codigo: subtipoInfo.codigo,
      nome: subtipoInfo.nome,
      tipo_id: subtipoInfo.tipo_id,
    },
  });

  revalidatePath("/financeiro/cadastros/plano-de-contas");
  return { ok: true, id };
}

export async function reativarSubtipo(id: string): Promise<ActionResult> {
  const session = await requireSession();

  if (!temPermissao(session.activeRole)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      metadata: { acao_tentada: "plano_conta_subtipo.reativado" },
    });
    return { ok: false, message: "Sem permissão." };
  }

  const supabase = createClient();

  const { data: subtipoInfo } = await supabase
    .from("plano_contas_subtipos")
    .select("codigo, nome, tipo_id")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .single();

  if (!subtipoInfo) return { ok: false, message: "Subtipo não encontrado." };

  const { error } = await supabase
    .from("plano_contas_subtipos")
    .update({ ativo: true })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[plano_contas_subtipos.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar o subtipo." };
  }

  await logAuditEvent({
    acao: "plano_conta_subtipo.reativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "plano_conta_subtipo",
    entidadeId: id,
    metadata: {
      codigo: subtipoInfo.codigo,
      nome: subtipoInfo.nome,
      tipo_id: subtipoInfo.tipo_id,
    },
  });

  revalidatePath("/financeiro/cadastros/plano-de-contas");
  return { ok: true, id };
}
