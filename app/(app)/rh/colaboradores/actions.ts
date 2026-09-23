"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { normalizarChavePix } from "@/lib/pix";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  colaboradorSchema,
  alocacaoInicialSchema,
  salarioSchema,
  dadosBancariosColaboradorSchema,
} from "@/lib/validations/rh-colaboradores";

type ActionResult<T = { id: string }> =
  | ({ ok: true } & T)
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function mapColaboradorDbError(msg: string): string {
  if (msg.includes("uniq_colaboradores_documento_por_tenant")) {
    return "Já existe um colaborador com esse CPF/CNPJ.";
  }
  if (msg.includes("chk_colaboradores_cpf_cnpj_formato")) {
    return "Formato do documento não bate com o tipo de contratação.";
  }
  if (msg.includes("chk_colaboradores_encerramento_coerente")) {
    return "Data de encerramento só pode existir em colaborador inativo.";
  }
  if (msg.includes("chk_colaboradores_nome_nao_vazio")) {
    return "Nome não pode ficar vazio.";
  }
  if (msg.includes("Rateio de alocacoes")) {
    return "A soma dos percentuais das alocações vigentes precisa dar 100.";
  }
  return "Não foi possível salvar o colaborador.";
}

/**
 * Cadastra colaborador com alocação inicial (100%) e salário inicial em
 * transação lógica: se qualquer inserção falhar, faz rollback manual.
 *
 * Supabase-js REST não faz transação SQL de fato, mas usamos o cliente
 * service_role para conseguir deletar em caso de falha parcial (o cliente
 * normal pode não ter privilégio de DELETE em colaboradores). Estratégia:
 *   1. Insere colaborador (retorna id)
 *   2. Insere alocação inicial 100%
 *   3. Insere salário inicial
 *   Se 2 ou 3 falhar → deleta colaborador (cascade limpa alocação/salário
 *   já criados; trigger de soma=100 é deferrable, então não bloqueia).
 */
export async function criarColaborador(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  const colaboradorParsed = colaboradorSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    tipo_contratacao: formData.get("tipo_contratacao")?.toString() ?? "",
    cpf_cnpj: formData.get("cpf_cnpj")?.toString() ?? "",
    funcao: formData.get("funcao")?.toString() ?? "",
    nivel_id: formData.get("nivel_id")?.toString() ?? "",
    data_admissao: formData.get("data_admissao")?.toString() ?? "",
  });
  if (!colaboradorParsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: colaboradorParsed.error.flatten().fieldErrors,
    };
  }

  const alocacaoParsed = alocacaoInicialSchema.safeParse({
    empresa_id: formData.get("empresa_id")?.toString() ?? "",
    regional_id: formData.get("regional_id")?.toString() ?? "",
    data_inicio: colaboradorParsed.data.data_admissao,
  });
  if (!alocacaoParsed.success) {
    return {
      ok: false,
      message: "Verifique a alocação inicial.",
      fieldErrors: alocacaoParsed.error.flatten().fieldErrors,
    };
  }

  const salarioParsed = salarioSchema.safeParse({
    valor: formData.get("salario_valor")?.toString() ?? "",
    data_inicio: colaboradorParsed.data.data_admissao,
    motivo: "",
  });
  if (!salarioParsed.success) {
    return {
      ok: false,
      message: "Verifique o salário inicial.",
      fieldErrors: salarioParsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  // 1) Insere colaborador
  const { data: colabData, error: colabError } = await supabase
    .from("colaboradores")
    .insert({
      tenant_id: session.activeTenant.id,
      nome: colaboradorParsed.data.nome,
      email: colaboradorParsed.data.email,
      tipo_contratacao: colaboradorParsed.data.tipo_contratacao,
      cpf_cnpj: colaboradorParsed.data.cpf_cnpj,
      funcao: colaboradorParsed.data.funcao,
      nivel_id: colaboradorParsed.data.nivel_id,
      data_admissao: colaboradorParsed.data.data_admissao,
      status: "ativo",
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (colabError) {
    console.error("[rh.colaborador.criar]", colabError.message);
    return { ok: false, message: mapColaboradorDbError(colabError.message) };
  }

  const colaboradorId = colabData.id;
  const service = createServiceClient();

  // 2) Alocação inicial 100%
  const { error: alocError } = await supabase
    .from("colaboradores_alocacoes")
    .insert({
      tenant_id: session.activeTenant.id,
      colaborador_id: colaboradorId,
      empresa_id: alocacaoParsed.data.empresa_id,
      regional_id: alocacaoParsed.data.regional_id,
      percentual: "100.00",
      data_inicio: alocacaoParsed.data.data_inicio,
      created_by: session.profile.id,
    });

  if (alocError) {
    console.error("[rh.colaborador.criar.alocacao]", alocError.message);
    await service.from("colaboradores").delete().eq("id", colaboradorId);
    return { ok: false, message: mapColaboradorDbError(alocError.message) };
  }

  // 3) Salário inicial
  const { error: salError } = await supabase
    .from("colaboradores_salarios")
    .insert({
      tenant_id: session.activeTenant.id,
      colaborador_id: colaboradorId,
      valor: salarioParsed.data.valor,
      data_inicio: salarioParsed.data.data_inicio,
      motivo: "Cadastro inicial",
      created_by: session.profile.id,
    });

  if (salError) {
    console.error("[rh.colaborador.criar.salario]", salError.message);
    await service.from("colaboradores").delete().eq("id", colaboradorId);
    return { ok: false, message: "Não foi possível gravar o salário inicial." };
  }

  await logAuditEvent({
    acao: "colaborador.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador",
    entidadeId: colaboradorId,
    metadata: {
      nome: colaboradorParsed.data.nome,
      tipo_contratacao: colaboradorParsed.data.tipo_contratacao,
      funcao: colaboradorParsed.data.funcao,
      empresa_id: alocacaoParsed.data.empresa_id,
      regional_id: alocacaoParsed.data.regional_id,
      salario_inicial: salarioParsed.data.valor,
    },
  });

  revalidatePath("/rh");
  revalidatePath("/rh/colaboradores");
  return { ok: true, id: colaboradorId };
}

/**
 * Edita dados fixos do colaborador (não mexe em alocação nem salário).
 * Alocação e salário têm actions próprias.
 */
export async function editarColaborador(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  const parsed = colaboradorSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    tipo_contratacao: formData.get("tipo_contratacao")?.toString() ?? "",
    cpf_cnpj: formData.get("cpf_cnpj")?.toString() ?? "",
    funcao: formData.get("funcao")?.toString() ?? "",
    nivel_id: formData.get("nivel_id")?.toString() ?? "",
    data_admissao: formData.get("data_admissao")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("colaboradores")
    .update({
      nome: parsed.data.nome,
      email: parsed.data.email,
      tipo_contratacao: parsed.data.tipo_contratacao,
      cpf_cnpj: parsed.data.cpf_cnpj,
      funcao: parsed.data.funcao,
      nivel_id: parsed.data.nivel_id,
      data_admissao: parsed.data.data_admissao,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[rh.colaborador.editar]", error.message);
    return { ok: false, message: mapColaboradorDbError(error.message) };
  }

  await logAuditEvent({
    acao: "colaborador.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador",
    entidadeId: id,
    metadata: {
      nome: parsed.data.nome,
      tipo_contratacao: parsed.data.tipo_contratacao,
      funcao: parsed.data.funcao,
    },
  });

  revalidatePath("/rh");
  revalidatePath("/rh/colaboradores");
  revalidatePath(`/rh/colaboradores/${id}`);
  return { ok: true, id };
}

export async function inativarColaborador(
  id: string,
  dataEncerramento: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataEncerramento)) {
    return { ok: false, message: "Data de encerramento inválida." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("colaboradores")
    .update({
      status: "inativo",
      data_encerramento: dataEncerramento,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[rh.colaborador.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar o colaborador." };
  }

  await logAuditEvent({
    acao: "colaborador.inativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador",
    entidadeId: id,
    metadata: { data_encerramento: dataEncerramento },
  });

  revalidatePath("/rh");
  revalidatePath("/rh/colaboradores");
  revalidatePath(`/rh/colaboradores/${id}`);
  return { ok: true, id };
}

/**
 * Salva dados bancários (banco/agência/conta/PIX) do colaborador. Usados
 * pelo gerador de remessa CNAB — módulo pgto-remessa. Todos os campos
 * são opcionais; o gate de completude é a hora de gerar remessa.
 */
export async function salvarDadosBancariosColaborador(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  const parsed = dadosBancariosColaboradorSchema.safeParse({
    banco_codigo: formData.get("banco_codigo")?.toString() ?? "",
    banco_nome: formData.get("banco_nome")?.toString() ?? "",
    agencia: formData.get("agencia")?.toString() ?? "",
    agencia_dv: formData.get("agencia_dv")?.toString() ?? "",
    conta: formData.get("conta")?.toString() ?? "",
    conta_dv: formData.get("conta_dv")?.toString() ?? "",
    tipo_conta: formData.get("tipo_conta")?.toString() || undefined,
    pix_tipo: formData.get("pix_tipo")?.toString() || undefined,
    pix_chave: formData.get("pix_chave")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("colaboradores")
    .update({
      banco_codigo: parsed.data.banco_codigo,
      banco_nome: parsed.data.banco_nome,
      agencia: parsed.data.agencia,
      agencia_dv: parsed.data.agencia_dv,
      conta: parsed.data.conta,
      conta_dv: parsed.data.conta_dv,
      tipo_conta: parsed.data.tipo_conta,
      pix_tipo: parsed.data.pix_tipo,
      // A chave grava no formato do banco (decisão 090), como no
      // fornecedor: é assim que ela sai no arquivo de remessa.
      pix_chave:
        normalizarChavePix(parsed.data.pix_tipo, parsed.data.pix_chave) ??
        null,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[rh.colaborador.dados_bancarios]", error.message);
    return { ok: false, message: "Não foi possível salvar os dados bancários." };
  }

  await logAuditEvent({
    acao: "colaborador.dados_bancarios_editados",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador",
    entidadeId: id,
    metadata: {
      tem_banco: parsed.data.banco_codigo !== null,
      tem_pix: parsed.data.pix_chave !== null,
      banco_codigo: parsed.data.banco_codigo,
      pix_tipo: parsed.data.pix_tipo,
    },
  });

  revalidatePath("/rh");
  revalidatePath("/rh/colaboradores");
  revalidatePath(`/rh/colaboradores/${id}`);
  return { ok: true, id };
}

export async function reativarColaborador(
  id: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const { error } = await supabase
    .from("colaboradores")
    .update({
      status: "ativo",
      data_encerramento: null,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[rh.colaborador.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar o colaborador." };
  }

  await logAuditEvent({
    acao: "colaborador.reativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "colaborador",
    entidadeId: id,
  });

  revalidatePath("/rh");
  revalidatePath("/rh/colaboradores");
  revalidatePath(`/rh/colaboradores/${id}`);
  return { ok: true, id };
}
