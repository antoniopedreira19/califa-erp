"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import type { BeneficioModoCusteio } from "@/lib/types";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string };

function assertRh(role: string): ActionResult | null {
  if (role !== "administrador" && role !== "rh") {
    return { ok: false, message: "Sem permissão para esta ação." };
  }
  return null;
}

const criarVinculoSchema = z.object({
  colaboradorId: z.string().uuid("Colaborador inválido."),
  beneficioId: z.string().uuid("Benefício inválido."),
  modoCusteio: z.enum([
    "rateado",
    "integral_empresa",
    "integral_empresa_com_upgrade",
  ]),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de início inválida."),
  observacao: z.string().max(500).optional().nullable(),
});

export async function criarVinculo(
  input: z.input<typeof criarVinculoSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = criarVinculoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const data = parsed.data;

  const supabase = createClient();
  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id, data_nascimento, cpf")
    .eq("id", data.colaboradorId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!colab) {
    return { ok: false, message: "Colaborador não encontrado." };
  }
  if (!colab.data_nascimento) {
    return {
      ok: false,
      message:
        "Colaborador sem data de nascimento. Edite o cadastro antes de vincular um benefício.",
    };
  }
  if (!colab.cpf) {
    return {
      ok: false,
      message: "Colaborador sem CPF. Edite o cadastro antes de vincular um benefício.",
    };
  }

  const { data: inserido, error } = await supabase
    .from("colaborador_beneficio")
    .insert({
      tenant_id: session.activeTenant.id,
      colaborador_id: data.colaboradorId,
      beneficio_id: data.beneficioId,
      modo_custeio: data.modoCusteio,
      data_inicio: data.dataInicio,
      observacao: data.observacao || null,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        message: "Já existe um vínculo ativo deste colaborador com este benefício.",
      };
    }
    if (error.message.includes("beneficio_base_id")) {
      return {
        ok: false,
        message:
          "O modo 'integral empresa com upgrade' só se aplica a benefícios de upgrade (ex.: Especial). Escolha outro modo.",
      };
    }
    return { ok: false, message: `Erro ao criar vínculo: ${error.message}` };
  }

  await logAuditEvent({
    acao: "beneficio.vinculo.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador_beneficio",
    entidadeId: inserido.id,
    metadata: {
      colaborador_id: data.colaboradorId,
      beneficio_id: data.beneficioId,
      modo_custeio: data.modoCusteio,
      data_inicio: data.dataInicio,
    },
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: inserido.id };
}

const encerrarVinculoSchema = z.object({
  vinculoId: z.string().uuid(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de encerramento inválida."),
});

export async function encerrarVinculo(
  input: z.input<typeof encerrarVinculoSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = encerrarVinculoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = createClient();
  const { data: vinc } = await supabase
    .from("colaborador_beneficio")
    .select("id, colaborador_id, beneficio_id, data_inicio, data_fim")
    .eq("id", parsed.data.vinculoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!vinc) {
    return { ok: false, message: "Vínculo não encontrado." };
  }
  if (vinc.data_fim) {
    return { ok: false, message: "Vínculo já está encerrado." };
  }
  if (parsed.data.dataFim < vinc.data_inicio) {
    return {
      ok: false,
      message: "Data de encerramento não pode ser anterior ao início do vínculo.",
    };
  }

  const { error } = await supabase
    .from("colaborador_beneficio")
    .update({ data_fim: parsed.data.dataFim })
    .eq("id", parsed.data.vinculoId);
  if (error) return { ok: false, message: `Erro ao encerrar: ${error.message}` };

  await logAuditEvent({
    acao: "beneficio.vinculo.encerrado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador_beneficio",
    entidadeId: parsed.data.vinculoId,
    metadata: {
      colaborador_id: vinc.colaborador_id,
      beneficio_id: vinc.beneficio_id,
      data_fim: parsed.data.dataFim,
    },
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: parsed.data.vinculoId };
}

const excluirVinculoSchema = z.object({
  vinculoId: z.string().uuid(),
});

export async function excluirVinculo(
  input: z.input<typeof excluirVinculoSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = excluirVinculoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = createClient();
  const { data: vinc } = await supabase
    .from("colaborador_beneficio")
    .select("id, colaborador_id, beneficio_id, modo_custeio, data_inicio, data_fim")
    .eq("id", parsed.data.vinculoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!vinc) {
    return { ok: false, message: "Vínculo não encontrado." };
  }

  const { error } = await supabase
    .from("colaborador_beneficio")
    .delete()
    .eq("id", parsed.data.vinculoId);
  if (error) {
    if (error.code === "23503") {
      return {
        ok: false,
        message:
          "Vínculo já incluído em um fechamento mensal — não pode ser excluído. Use Encerrar para marcar o fim.",
      };
    }
    return { ok: false, message: `Erro ao excluir: ${error.message}` };
  }

  await logAuditEvent({
    acao: "beneficio.vinculo.excluido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador_beneficio",
    entidadeId: parsed.data.vinculoId,
    metadata: {
      colaborador_id: vinc.colaborador_id,
      beneficio_id: vinc.beneficio_id,
      modo_custeio: vinc.modo_custeio,
      data_inicio: vinc.data_inicio,
      data_fim: vinc.data_fim,
    },
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: parsed.data.vinculoId };
}

const editarVinculoSchema = z.object({
  vinculoId: z.string().uuid(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de início inválida."),
  dataFim: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de fim inválida.")
    .nullable(),
  observacao: z.string().max(500).nullable(),
});

export async function editarVinculo(
  input: z.input<typeof editarVinculoSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = editarVinculoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const d = parsed.data;

  if (d.dataFim && d.dataFim < d.dataInicio) {
    return {
      ok: false,
      message: "Data de fim não pode ser anterior à data de início.",
    };
  }

  const supabase = createClient();
  const { data: vinc } = await supabase
    .from("colaborador_beneficio")
    .select("id, colaborador_id, beneficio_id, data_inicio, data_fim, observacao")
    .eq("id", d.vinculoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!vinc) return { ok: false, message: "Vínculo não encontrado." };

  const { error } = await supabase
    .from("colaborador_beneficio")
    .update({
      data_inicio: d.dataInicio,
      data_fim: d.dataFim,
      observacao: d.observacao,
    })
    .eq("id", d.vinculoId);
  if (error) return { ok: false, message: `Erro ao editar: ${error.message}` };

  await logAuditEvent({
    acao: "beneficio.vinculo.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador_beneficio",
    entidadeId: d.vinculoId,
    metadata: {
      colaborador_id: vinc.colaborador_id,
      beneficio_id: vinc.beneficio_id,
      data_inicio_anterior: vinc.data_inicio,
      data_inicio_nova: d.dataInicio,
      data_fim_anterior: vinc.data_fim,
      data_fim_nova: d.dataFim,
      observacao_alterada: vinc.observacao !== d.observacao,
    },
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: d.vinculoId };
}

const definirOverrideSchema = z.object({
  vinculoId: z.string().uuid(),
  valor: z.number().min(0, "Valor não pode ser negativo.").max(100000),
  motivo: z
    .string()
    .trim()
    .min(3, "Motivo é obrigatório — mínimo 3 caracteres.")
    .max(500),
});

export async function definirOverrideBeneficio(
  input: z.input<typeof definirOverrideSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = definirOverrideSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const d = parsed.data;

  const supabase = createClient();
  const { data: vinc } = await supabase
    .from("colaborador_beneficio")
    .select("id, colaborador_id, beneficio_id, valor_colaborador_override, override_motivo, data_fim")
    .eq("id", d.vinculoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!vinc) return { ok: false, message: "Vínculo não encontrado." };
  if (vinc.data_fim) {
    return {
      ok: false,
      message: "Vínculo encerrado não pode receber valor custom.",
    };
  }

  const { error } = await supabase
    .from("colaborador_beneficio")
    .update({
      valor_colaborador_override: d.valor,
      override_motivo: d.motivo,
    })
    .eq("id", d.vinculoId);
  if (error) return { ok: false, message: `Erro ao salvar valor custom: ${error.message}` };

  await logAuditEvent({
    acao: "beneficio.vinculo.override_definido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador_beneficio",
    entidadeId: d.vinculoId,
    metadata: {
      colaborador_id: vinc.colaborador_id,
      beneficio_id: vinc.beneficio_id,
      valor_anterior: vinc.valor_colaborador_override,
      valor_novo: d.valor,
      motivo_anterior: vinc.override_motivo,
      motivo_novo: d.motivo,
    },
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: d.vinculoId };
}

const removerOverrideSchema = z.object({
  vinculoId: z.string().uuid(),
});

export async function removerOverrideBeneficio(
  input: z.input<typeof removerOverrideSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = removerOverrideSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = createClient();
  const { data: vinc } = await supabase
    .from("colaborador_beneficio")
    .select("id, colaborador_id, beneficio_id, valor_colaborador_override, override_motivo")
    .eq("id", parsed.data.vinculoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!vinc) return { ok: false, message: "Vínculo não encontrado." };
  if (vinc.valor_colaborador_override === null) {
    return { ok: false, message: "Este vínculo já segue o cálculo padrão." };
  }

  const { error } = await supabase
    .from("colaborador_beneficio")
    .update({
      valor_colaborador_override: null,
      override_motivo: null,
    })
    .eq("id", parsed.data.vinculoId);
  if (error) return { ok: false, message: `Erro ao remover valor custom: ${error.message}` };

  await logAuditEvent({
    acao: "beneficio.vinculo.override_removido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador_beneficio",
    entidadeId: parsed.data.vinculoId,
    metadata: {
      colaborador_id: vinc.colaborador_id,
      beneficio_id: vinc.beneficio_id,
      valor_removido: vinc.valor_colaborador_override,
      motivo_removido: vinc.override_motivo,
    },
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: parsed.data.vinculoId };
}

const mudarModoSchema = z.object({
  vinculoId: z.string().uuid(),
  novoModo: z.enum([
    "rateado",
    "integral_empresa",
    "integral_empresa_com_upgrade",
  ]),
  dataMudanca: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data da mudança inválida.")
    .optional(),
});

export async function mudarModoCusteio(
  input: z.input<typeof mudarModoSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = mudarModoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = createClient();
  const { data: vincAtual } = await supabase
    .from("colaborador_beneficio")
    .select("id, colaborador_id, beneficio_id, modo_custeio")
    .eq("id", parsed.data.vinculoId)
    .eq("tenant_id", session.activeTenant.id)
    .is("data_fim", null)
    .maybeSingle();
  if (!vincAtual) {
    return { ok: false, message: "Vínculo ativo não encontrado." };
  }
  if ((vincAtual.modo_custeio as BeneficioModoCusteio) === parsed.data.novoModo) {
    return {
      ok: false,
      message: "O novo modo é igual ao atual. Nada a fazer.",
    };
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const dataMudanca = parsed.data.dataMudanca ?? hoje;

  const { data: novoId, error } = await supabase.rpc(
    "fn_mudar_modo_custeio_beneficio",
    {
      p_vinculo_id: parsed.data.vinculoId,
      p_novo_modo: parsed.data.novoModo,
      p_data_mudanca: dataMudanca,
    },
  );
  if (error) {
    if (error.message.includes("beneficio_base_id")) {
      return {
        ok: false,
        message:
          "O modo 'integral empresa com upgrade' só se aplica a benefícios de upgrade (ex.: Especial).",
      };
    }
    return { ok: false, message: `Erro ao mudar modo: ${error.message}` };
  }

  await logAuditEvent({
    acao: "beneficio.vinculo.modo_alterado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador_beneficio",
    entidadeId: novoId as string,
    metadata: {
      vinculo_anterior_id: parsed.data.vinculoId,
      colaborador_id: vincAtual.colaborador_id,
      beneficio_id: vincAtual.beneficio_id,
      modo_custeio_anterior: vincAtual.modo_custeio,
      modo_custeio_novo: parsed.data.novoModo,
      data_mudanca: dataMudanca,
    },
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: novoId as string };
}
