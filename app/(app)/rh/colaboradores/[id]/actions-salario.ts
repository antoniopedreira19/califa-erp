"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient } from "@/lib/supabase/server";
import { salarioSchema } from "@/lib/validations/rh-colaboradores";

type ActionResult<T = { id: string }> =
  | ({ ok: true } & T)
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Registra uma MUDANÇA SALARIAL:
 *   1. Fecha o salário vigente com data_fim = data_inicio da mudança
 *   2. Insere uma nova linha vigente
 * Constraint unique parcial em (colaborador_id) WHERE data_fim IS NULL
 * garante que só uma linha por colaborador fica vigente.
 */
export async function registrarMudancaSalarial(
  colaboradorId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  const parsed = salarioSchema.safeParse({
    valor: formData.get("valor")?.toString() ?? "",
    valor_recibo: formData.get("valor_recibo")?.toString() ?? "",
    data_inicio: formData.get("data_inicio")?.toString() ?? "",
    motivo: formData.get("motivo")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  // Confirma colaborador do tenant e descobre tipo (precisa pra validar valor_recibo)
  const { data: colab, error: colabError } = await supabase
    .from("colaboradores")
    .select("id, tipo_contratacao")
    .eq("id", colaboradorId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (colabError || !colab) {
    return { ok: false, message: "Colaborador não encontrado." };
  }

  // Coerência valor_recibo <-> tipo_contratacao (o trigger do banco também valida,
  // mas aqui damos erro claro antes de bater no CHECK).
  const ehHibrido = colab.tipo_contratacao === "clt_recibo";
  let valorReciboFinal: string | null = parsed.data.valor_recibo;
  if (ehHibrido) {
    if (valorReciboFinal == null) {
      return {
        ok: false,
        message:
          "Para colaborador CLT + Recibo é obrigatório informar a parte Recibo (RPA).",
        fieldErrors: { valor_recibo: ["Informe a parte Recibo."] },
      };
    }
    if (Number(valorReciboFinal) > Number(parsed.data.valor)) {
      return {
        ok: false,
        message: "A parte Recibo não pode ser maior que o salário total.",
        fieldErrors: { valor_recibo: ["Parte Recibo maior que o total."] },
      };
    }
  } else {
    // Força NULL em qualquer tipo que não seja clt_recibo (o CHECK do banco bloqueia).
    valorReciboFinal = null;
  }

  // Pega o vigente pra fechar (e capturar valor anterior no audit)
  const { data: vigente } = await supabase
    .from("colaboradores_salarios")
    .select("id, valor, valor_recibo")
    .eq("colaborador_id", colaboradorId)
    .is("data_fim", null)
    .maybeSingle();

  // 1) Fecha vigente
  if (vigente) {
    const { error: upError } = await supabase
      .from("colaboradores_salarios")
      .update({ data_fim: parsed.data.data_inicio })
      .eq("id", vigente.id);
    if (upError) {
      console.error("[rh.salario.fechar]", upError.message);
      return { ok: false, message: "Não foi possível fechar o salário atual." };
    }
  }

  // 2) Insere novo
  const { error: insError } = await supabase
    .from("colaboradores_salarios")
    .insert({
      tenant_id: session.activeTenant.id,
      colaborador_id: colaboradorId,
      valor: parsed.data.valor,
      valor_recibo: valorReciboFinal,
      data_inicio: parsed.data.data_inicio,
      motivo: parsed.data.motivo,
      created_by: session.profile.id,
    });

  if (insError) {
    console.error("[rh.salario.novo]", insError.message);
    return { ok: false, message: "Não foi possível gravar o novo salário." };
  }

  await logAuditEvent({
    acao: "colaborador.salario_mudou",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador",
    entidadeId: colaboradorId,
    metadata: {
      valor_anterior: vigente?.valor ?? null,
      valor_novo: parsed.data.valor,
      valor_recibo_anterior: vigente?.valor_recibo ?? null,
      valor_recibo_novo: valorReciboFinal,
      data_inicio: parsed.data.data_inicio,
      motivo: parsed.data.motivo,
    },
  });

  revalidatePath(`/rh/colaboradores/${colaboradorId}`);
  return { ok: true, id: colaboradorId };
}

/**
 * Corrige o VALOR do salário vigente sem gerar nova linha — para
 * correção de digitação. Restrito a administrador. Auditado com valor
 * anterior.
 */
export async function corrigirSalarioAtual(
  colaboradorId: string,
  valorNovo: string,
  valorReciboNovo?: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (session.activeRole !== "administrador") {
    return {
      ok: false,
      message: "Apenas administrador pode corrigir salário sem gerar histórico.",
    };
  }

  const parsed = salarioSchema
    .pick({ valor: true, valor_recibo: true })
    .safeParse({ valor: valorNovo, valor_recibo: valorReciboNovo ?? "" });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Valor inválido.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const { data: vigente, error: vigenteError } = await supabase
    .from("colaboradores_salarios")
    .select("id, valor, valor_recibo, tenant_id, colaborador:colaboradores(tipo_contratacao)")
    .eq("colaborador_id", colaboradorId)
    .is("data_fim", null)
    .maybeSingle();
  if (vigenteError || !vigente) {
    return {
      ok: false,
      message: "Não há salário vigente para corrigir.",
    };
  }
  if (vigente.tenant_id !== session.activeTenant.id) {
    return { ok: false, message: "Colaborador de outro tenant." };
  }

  const tipo = (vigente as unknown as {
    colaborador: { tipo_contratacao: string } | null;
  }).colaborador?.tipo_contratacao;
  const ehHibrido = tipo === "clt_recibo";
  let valorReciboFinal: string | null = parsed.data.valor_recibo;
  if (ehHibrido) {
    if (valorReciboFinal == null) {
      return {
        ok: false,
        message: "Informe a parte Recibo (RPA).",
        fieldErrors: { valor_recibo: ["Informe a parte Recibo."] },
      };
    }
    if (Number(valorReciboFinal) > Number(parsed.data.valor)) {
      return {
        ok: false,
        message: "A parte Recibo não pode ser maior que o salário total.",
        fieldErrors: { valor_recibo: ["Parte Recibo maior que o total."] },
      };
    }
  } else {
    valorReciboFinal = null;
  }

  const { error: upError } = await supabase
    .from("colaboradores_salarios")
    .update({ valor: parsed.data.valor, valor_recibo: valorReciboFinal })
    .eq("id", vigente.id);
  if (upError) {
    console.error("[rh.salario.corrigir]", upError.message);
    return { ok: false, message: "Não foi possível corrigir o valor." };
  }

  await logAuditEvent({
    acao: "colaborador.salario_corrigido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador",
    entidadeId: colaboradorId,
    metadata: {
      valor_anterior: vigente.valor,
      valor_novo: parsed.data.valor,
      valor_recibo_anterior: vigente.valor_recibo,
      valor_recibo_novo: valorReciboFinal,
    },
  });

  revalidatePath(`/rh/colaboradores/${colaboradorId}`);
  return { ok: true, id: colaboradorId };
}
