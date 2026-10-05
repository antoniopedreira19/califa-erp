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

function limparCpf(cpf: string): string {
  return cpf.replace(/\D/g, "");
}

const PARENTESCOS = [
  "conjuge",
  "filho",
  "filha",
  "pai",
  "mae",
  "irmao",
  "irma",
  "outro",
] as const;

const criarDepSchema = z.object({
  colaboradorId: z.string().uuid(),
  nome: z.string().min(2, "Nome é obrigatório.").max(200),
  cpf: z
    .string()
    .transform(limparCpf)
    .refine((v) => v.length === 11, "CPF precisa de 11 dígitos."),
  dataNascimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de nascimento inválida.")
    .refine(
      (v) => v <= new Date().toISOString().slice(0, 10),
      "Data de nascimento não pode ser futura.",
    ),
  parentesco: z.string().min(1, "Parentesco é obrigatório.").max(50),
  observacao: z.string().max(500).optional().nullable(),
});

export async function criarDependente(
  input: z.input<typeof criarDepSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = criarDepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const d = parsed.data;

  const supabase = createClient();
  const { data: inserido, error } = await supabase
    .from("dependentes")
    .insert({
      tenant_id: session.activeTenant.id,
      colaborador_id: d.colaboradorId,
      nome: d.nome,
      cpf: d.cpf,
      data_nascimento: d.dataNascimento,
      parentesco: d.parentesco,
      observacao: d.observacao || null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        message:
          "Este CPF já está cadastrado como dependente de outro colaborador neste tenant.",
      };
    }
    return { ok: false, message: `Erro ao cadastrar dependente: ${error.message}` };
  }

  await logAuditEvent({
    acao: "beneficio.dependente.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "dependente",
    entidadeId: inserido.id,
    metadata: {
      colaborador_id: d.colaboradorId,
      parentesco: d.parentesco,
    },
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: inserido.id };
}

const editarDepSchema = z.object({
  dependenteId: z.string().uuid(),
  nome: z.string().min(2).max(200),
  parentesco: z.string().min(1).max(50),
  observacao: z.string().max(500).optional().nullable(),
});

export async function editarDependente(
  input: z.input<typeof editarDepSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = editarDepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("dependentes")
    .update({
      nome: parsed.data.nome,
      parentesco: parsed.data.parentesco,
      observacao: parsed.data.observacao || null,
    })
    .eq("id", parsed.data.dependenteId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) return { ok: false, message: `Erro ao editar: ${error.message}` };

  await logAuditEvent({
    acao: "beneficio.dependente.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "dependente",
    entidadeId: parsed.data.dependenteId,
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: parsed.data.dependenteId };
}

const desativarDepSchema = z.object({
  dependenteId: z.string().uuid(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
});

export async function desativarDependente(
  input: z.input<typeof desativarDepSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = desativarDepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("dependentes")
    .update({ ativo: false, data_fim: parsed.data.dataFim })
    .eq("id", parsed.data.dependenteId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) return { ok: false, message: `Erro ao desativar: ${error.message}` };

  await logAuditEvent({
    acao: "beneficio.dependente.desativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "dependente",
    entidadeId: parsed.data.dependenteId,
    metadata: { data_fim: parsed.data.dataFim },
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: parsed.data.dependenteId };
}

const incluirDepSchema = z.object({
  vinculoId: z.string().uuid(),
  dependenteId: z.string().uuid(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
});

export async function incluirDepEmPlano(
  input: z.input<typeof incluirDepSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = incluirDepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = createClient();
  const { data: inserido, error } = await supabase
    .from("colaborador_beneficio_dependente")
    .insert({
      colaborador_beneficio_id: parsed.data.vinculoId,
      dependente_id: parsed.data.dependenteId,
      data_inicio: parsed.data.dataInicio,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        message: "Este dependente já está incluído neste plano.",
      };
    }
    return { ok: false, message: `Erro ao incluir no plano: ${error.message}` };
  }

  await logAuditEvent({
    acao: "beneficio.dependente.incluido_em_plano",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador_beneficio_dependente",
    entidadeId: inserido.id,
    metadata: {
      vinculo_id: parsed.data.vinculoId,
      dependente_id: parsed.data.dependenteId,
      data_inicio: parsed.data.dataInicio,
    },
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: inserido.id };
}

const removerDepSchema = z.object({
  linkId: z.string().uuid(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
});

export async function removerDepDePlano(
  input: z.input<typeof removerDepSchema>,
): Promise<ActionResult> {
  const session = await requireSession();
  const bloqueio = assertRh(session.activeRole);
  if (bloqueio) return bloqueio;

  const parsed = removerDepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("colaborador_beneficio_dependente")
    .update({ data_fim: parsed.data.dataFim })
    .eq("id", parsed.data.linkId);

  if (error) return { ok: false, message: `Erro ao remover: ${error.message}` };

  await logAuditEvent({
    acao: "beneficio.dependente.removido_de_plano",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador_beneficio_dependente",
    entidadeId: parsed.data.linkId,
    metadata: { data_fim: parsed.data.dataFim },
  });

  revalidatePath("/rh/beneficios");
  return { ok: true, id: parsed.data.linkId };
}

export { PARENTESCOS };
