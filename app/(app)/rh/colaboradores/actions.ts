"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  colaboradorSchema,
  alocacaoInicialSchema,
  salarioSchema,
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
 * Busca fornecedor existente por documento (CPF/CNPJ, dígitos puros).
 * Usado no cadastro para auto-match: se já existe fornecedor com esse
 * documento, o form oferece vincular pra reusar dados bancários/PIX.
 */
export async function buscarFornecedorPorDocumento(
  cpfCnpj: string,
): Promise<
  | { ok: true; fornecedor: { id: string; nome: string } | null }
  | { ok: false; message: string }
> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.colaboradores.editar");
  if (!gate.ok) return gate;

  const digitos = (cpfCnpj ?? "").replace(/\D/g, "");
  if (digitos.length !== 11 && digitos.length !== 14) {
    return { ok: true, fornecedor: null };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("fornecedores")
    .select("id, nome")
    .eq("tenant_id", session.activeTenant.id)
    .eq("cpf_cnpj", digitos)
    .maybeSingle();

  if (error) {
    console.error("[rh.buscar_fornecedor]", error.message);
    return { ok: false, message: "Erro ao buscar fornecedor." };
  }

  return { ok: true, fornecedor: data ?? null };
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
 *
 * Opcional: se `criar_fornecedor` = "1", cria também um fornecedor com o
 * mesmo documento (só para PJ/MEI/CLT+Recibo) e vincula ao colaborador.
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
    fornecedor_id: formData.get("fornecedor_id")?.toString() ?? "",
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

  const criarFornecedor =
    formData.get("criar_fornecedor")?.toString() === "1" &&
    colaboradorParsed.data.cpf_cnpj !== null &&
    colaboradorParsed.data.fornecedor_id === null;

  const supabase = createClient();

  // 1) Criar fornecedor primeiro (se pedido), pra ter o id na inserção do colaborador
  let novoFornecedorId: string | null = null;
  if (criarFornecedor) {
    const tipo = colaboradorParsed.data.tipo_contratacao;
    const tipoPessoa =
      tipo === "clt" || tipo === "estagio" ? "fisica" : "juridica";
    const { data: fornData, error: fornError } = await supabase
      .from("fornecedores")
      .insert({
        tenant_id: session.activeTenant.id,
        tipo_pessoa: tipoPessoa,
        nome: colaboradorParsed.data.nome,
        cpf_cnpj: colaboradorParsed.data.cpf_cnpj,
        created_by: session.profile.id,
      })
      .select("id")
      .single();
    if (fornError) {
      console.error("[rh.colaborador.criar.fornecedor]", fornError.message);
      return {
        ok: false,
        message:
          fornError.message.includes("uniq_fornecedores_documento_por_tenant")
            ? "Já existe um fornecedor com esse documento. Vincule ao existente em vez de criar novo."
            : "Não foi possível criar o fornecedor.",
      };
    }
    novoFornecedorId = fornData.id;
    await logAuditEvent({
      acao: "fornecedor.criado",
      tenantId: session.activeTenant.id,
      entidadeTipo: "fornecedor",
      entidadeId: novoFornecedorId,
      metadata: {
        nome: colaboradorParsed.data.nome,
        origem: "rh_colaborador",
      },
    });
  }

  const fornecedorIdFinal =
    novoFornecedorId ?? colaboradorParsed.data.fornecedor_id;

  // 2) Insere colaborador
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
      fornecedor_id: fornecedorIdFinal,
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

  // 3) Alocação inicial 100%
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

  // 4) Salário inicial
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
    fornecedor_id: formData.get("fornecedor_id")?.toString() ?? "",
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
      fornecedor_id: parsed.data.fornecedor_id,
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
