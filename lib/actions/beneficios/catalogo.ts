"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string };

function assertRh(role: string): ActionResult | null {
  if (role !== "administrador" && role !== "rh") {
    return { ok: false, message: "Sem permissão para esta ação." };
  }
  return null;
}

const criarBeneficioSchema = z
  .object({
    nome: z.string().min(2).max(200),
    operadora: z.string().min(2).max(200),
    tipo: z.enum(["saude", "dental"]),
    modeloPreco: z.enum(["faixa_etaria", "flat"]),
    percentualEmpresaTitular: z.number().int().min(0).max(100),
    percentualColaboradorDependentes: z.number().int().min(0).max(100),
    valorFlat: z.number().positive().nullable(),
    beneficioBaseId: z.string().uuid().nullable(),
    codigoExterno: z.string().max(50).nullable(),
    observacao: z.string().max(500).nullable(),
  })
  .refine(
    (d) => (d.modeloPreco === "flat" ? d.valorFlat !== null : d.valorFlat === null),
    {
      message:
        "Valor flat obrigatório quando modelo = flat; proibido quando modelo = faixa etária.",
      path: ["valorFlat"],
    },
  );

export async function criarBeneficio(
  input: z.input<typeof criarBeneficioSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = criarBeneficioSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const d = parsed.data;

  const supabase = createClient();
  const { data: inserido, error } = await supabase
    .from("beneficios")
    .insert({
      tenant_id: session.activeTenant.id,
      nome: d.nome,
      operadora: d.operadora,
      tipo: d.tipo,
      modelo_preco: d.modeloPreco,
      percentual_empresa_titular: d.percentualEmpresaTitular,
      percentual_colaborador_dependentes: d.percentualColaboradorDependentes,
      valor_flat: d.valorFlat,
      beneficio_base_id: d.beneficioBaseId,
      codigo_externo: d.codigoExterno,
      observacao: d.observacao,
    })
    .select("id")
    .single();

  if (error) return { ok: false, message: `Erro ao criar benefício: ${error.message}` };

  await logAuditEvent({
    acao: "beneficio.catalogo.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "beneficio",
    entidadeId: inserido.id,
    metadata: { nome: d.nome, tipo: d.tipo, modelo_preco: d.modeloPreco },
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: inserido.id };
}

const editarBeneficioSchema = z.object({
  beneficioId: z.string().uuid(),
  nome: z.string().min(2).max(200),
  operadora: z.string().min(2).max(200),
  percentualEmpresaTitular: z.number().int().min(0).max(100),
  percentualColaboradorDependentes: z.number().int().min(0).max(100),
  valorFlat: z.number().positive().nullable(),
  beneficioBaseId: z.string().uuid().nullable(),
  codigoExterno: z.string().max(50).nullable(),
  ativo: z.boolean(),
  observacao: z.string().max(500).nullable(),
});

export async function editarBeneficio(
  input: z.input<typeof editarBeneficioSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = editarBeneficioSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const d = parsed.data;

  const supabase = createClient();
  const { error } = await supabase
    .from("beneficios")
    .update({
      nome: d.nome,
      operadora: d.operadora,
      percentual_empresa_titular: d.percentualEmpresaTitular,
      percentual_colaborador_dependentes: d.percentualColaboradorDependentes,
      valor_flat: d.valorFlat,
      beneficio_base_id: d.beneficioBaseId,
      codigo_externo: d.codigoExterno,
      ativo: d.ativo,
      observacao: d.observacao,
    })
    .eq("id", d.beneficioId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) return { ok: false, message: `Erro ao editar: ${error.message}` };

  await logAuditEvent({
    acao: "beneficio.catalogo.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "beneficio",
    entidadeId: d.beneficioId,
    metadata: { nome: d.nome, ativo: d.ativo },
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: d.beneficioId };
}

const criarFaixaSchema = z
  .object({
    beneficioId: z.string().uuid(),
    idadeMin: z.number().int().min(0).max(120),
    idadeMax: z.number().int().min(0).max(120).nullable(),
    valor: z.number().positive(),
  })
  .refine((d) => d.idadeMax === null || d.idadeMax >= d.idadeMin, {
    message: "Idade máxima precisa ser maior ou igual à mínima.",
    path: ["idadeMax"],
  });

export async function criarFaixa(
  input: z.input<typeof criarFaixaSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = criarFaixaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = createClient();
  const { data: inserido, error } = await supabase
    .from("beneficio_faixas_preco")
    .insert({
      beneficio_id: parsed.data.beneficioId,
      idade_min: parsed.data.idadeMin,
      idade_max: parsed.data.idadeMax,
      valor: parsed.data.valor,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        message: `Já existe faixa começando em ${parsed.data.idadeMin} para este benefício.`,
      };
    }
    return { ok: false, message: `Erro ao criar faixa: ${error.message}` };
  }

  await logAuditEvent({
    acao: "beneficio.faixa.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "beneficio_faixas_preco",
    entidadeId: inserido.id,
    metadata: {
      beneficio_id: parsed.data.beneficioId,
      idade_min: parsed.data.idadeMin,
      idade_max: parsed.data.idadeMax,
      valor: parsed.data.valor,
    },
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: inserido.id };
}

const editarFaixaSchema = z.object({
  faixaId: z.string().uuid(),
  idadeMin: z.number().int().min(0).max(120),
  idadeMax: z.number().int().min(0).max(120).nullable(),
  valor: z.number().positive(),
});

export async function editarFaixa(
  input: z.input<typeof editarFaixaSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = editarFaixaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("beneficio_faixas_preco")
    .update({
      idade_min: parsed.data.idadeMin,
      idade_max: parsed.data.idadeMax,
      valor: parsed.data.valor,
    })
    .eq("id", parsed.data.faixaId);

  if (error) return { ok: false, message: `Erro ao editar faixa: ${error.message}` };

  await logAuditEvent({
    acao: "beneficio.faixa.editada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "beneficio_faixas_preco",
    entidadeId: parsed.data.faixaId,
    metadata: {
      idade_min: parsed.data.idadeMin,
      idade_max: parsed.data.idadeMax,
      valor: parsed.data.valor,
    },
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: parsed.data.faixaId };
}

const removerFaixaSchema = z.object({ faixaId: z.string().uuid() });

export async function removerFaixa(
  input: z.input<typeof removerFaixaSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = removerFaixaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("beneficio_faixas_preco")
    .delete()
    .eq("id", parsed.data.faixaId);

  if (error) return { ok: false, message: `Erro ao remover faixa: ${error.message}` };

  await logAuditEvent({
    acao: "beneficio.faixa.removida",
    tenantId: session.activeTenant.id,
    entidadeTipo: "beneficio_faixas_preco",
    entidadeId: parsed.data.faixaId,
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: parsed.data.faixaId };
}
