"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import {
  clienteSchema,
  HONORARIOS_PADRAO_FALLBACK,
} from "@/lib/validations/clientes";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * `honorariosVazioVale12`: na edição de um cadastro antigo, campo vazio cai
 * no padrão da agência em vez de barrar o salvamento. Na criação o campo é
 * obrigatório — quem cadastra o cliente decide o percentual dele.
 */
function extractInput(
  formData: FormData,
  { honorariosVazioVale12 = false }: { honorariosVazioVale12?: boolean } = {},
) {
  const honorarios =
    formData.get("percentual_honorarios_padrao")?.toString().trim() ?? "";

  return {
    nome_fantasia: formData.get("nome_fantasia")?.toString() ?? "",
    codigo_curto: formData.get("codigo_curto")?.toString() ?? "",
    razao_social: formData.get("razao_social")?.toString() ?? "",
    cnpj: formData.get("cnpj")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    telefone: formData.get("telefone")?.toString() ?? "",
    observacoes: formData.get("observacoes")?.toString() ?? "",
    percentual_honorarios_padrao:
      honorarios === "" && honorariosVazioVale12
        ? String(HONORARIOS_PADRAO_FALLBACK)
        : honorarios,
  };
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_clientes_cnpj_por_tenant")) {
    return "Já existe um cliente com este CNPJ neste tenant.";
  }
  if (msg.includes("clientes_cnpj_only_digits")) {
    return "CNPJ deve conter apenas dígitos.";
  }
  if (msg.includes("uniq_clientes_codigo_curto_por_tenant")) {
    return "Já existe um cliente com este código.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

export async function criarCliente(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "cadastros.clientes.editar");
  if (!gate.ok) return gate;
  const parsed = clienteSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("clientes")
    .insert({
      ...parsed.data,
      tenant_id: session.activeTenant.id,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[clientes.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "cliente.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: data.id,
    metadata: { nome_fantasia: parsed.data.nome_fantasia },
  });

  // Todo cliente nasce com o produto padrão: o que representa a marca do
  // cliente — a matriz, quando não há outras marcas no guarda-chuva. Ele
  // é imutável (ver trigger `trg_cliente_produtos_padrao`) e resolve de
  // saída o beco de cliente sem produto, já que Produto é obrigatório no
  // formulário de projeto desde 06/08/2026.
  //
  // Código fixo em PRD-01: cliente recém-criado tem zero produtos, então
  // não vale gastar a query de contagem que `gerarCodigoProduto` faz.
  const { data: produto, error: errProduto } = await supabase
    .from("cliente_produtos")
    .insert({
      tenant_id: session.activeTenant.id,
      cliente_id: data.id,
      nome: parsed.data.nome_fantasia,
      codigo: "PRD-01",
      padrao: true,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  revalidatePath("/clientes");

  // O cliente já está gravado — PostgREST não dá transação para desfazer.
  // Avisamos em vez de redirecionar em silêncio para um cliente que não
  // abre projeto.
  if (errProduto) {
    console.error("[clientes.criar.produto_padrao]", errProduto.message);
    return {
      ok: false,
      message:
        "Cliente criado, mas o produto padrão não foi. Cadastre um produto na tela do cliente antes de abrir projetos.",
    };
  }

  await logAuditEvent({
    acao: "cliente_produto.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente_produto",
    entidadeId: produto.id,
    metadata: {
      cliente_id: data.id,
      nome: parsed.data.nome_fantasia,
      codigo: "PRD-01",
      padrao: true,
      origem: "padrao_na_criacao_do_cliente",
    },
  });

  redirect("/clientes");
}

export async function atualizarCliente(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "cadastros.clientes.editar");
  if (!gate.ok) return gate;
  const parsed = clienteSchema.safeParse(
    extractInput(formData, { honorariosVazioVale12: true }),
  );

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  // Nome anterior, lido antes do update: é ele que identifica o produto
  // homônimo criado por padrão — ver abaixo.
  const { data: anterior } = await supabase
    .from("clientes")
    .select("nome_fantasia, percentual_honorarios_padrao")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      nome_fantasia: string;
      percentual_honorarios_padrao: number;
    }>();

  const { error } = await supabase
    .from("clientes")
    .update(parsed.data)
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[clientes.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  // Honorários é condição comercial: mudança entra na auditoria com de/para.
  const honorariosMudou =
    anterior != null &&
    Number(anterior.percentual_honorarios_padrao) !==
      parsed.data.percentual_honorarios_padrao;

  await logAuditEvent({
    acao: "cliente.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: id,
    metadata: honorariosMudou
      ? {
          campo: "percentual_honorarios_padrao",
          de: Number(anterior!.percentual_honorarios_padrao),
          para: parsed.data.percentual_honorarios_padrao,
        }
      : undefined,
  });

  // O produto padrão é a marca do cliente, então o nome dele acompanha o
  // nome fantasia — sempre, sem exceção de "foi editado à mão": ninguém
  // consegue editá-lo (trigger `trg_cliente_produtos_padrao`). Só os
  // produtos comuns ficam intactos.
  //
  // Ordem importa: `clientes` já foi gravado acima, então o trigger vê os
  // dois nomes batendo e deixa passar.
  const nomeMudou =
    anterior != null && anterior.nome_fantasia !== parsed.data.nome_fantasia;

  if (nomeMudou) {
    const { error: errRename } = await supabase
      .from("cliente_produtos")
      .update({ nome: parsed.data.nome_fantasia })
      .eq("cliente_id", id)
      .eq("tenant_id", session.activeTenant.id)
      .eq("padrao", true);

    // Falha aqui não desfaz a edição do cliente. O caso esperado é
    // colisão com um produto comum que já usa o nome novo.
    if (errRename) {
      console.error("[clientes.atualizar.rename_produto]", errRename.message);
      return {
        ok: false,
        message:
          "Cliente renomeado, mas o produto que representa a marca continuou com o nome antigo — provavelmente já existe outro produto com esse nome neste cliente.",
      };
    }
  }

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${id}`);
  return { ok: true, id };
}

export async function inativarCliente(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "cadastros.clientes.editar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { error } = await supabase
    .from("clientes")
    .update({ status: "inativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[clientes.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar." };
  }

  await logAuditEvent({
    acao: "cliente.inativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: id,
  });

  revalidatePath("/clientes");
  return { ok: true, id };
}

export async function reativarCliente(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "cadastros.clientes.editar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { error } = await supabase
    .from("clientes")
    .update({ status: "ativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[clientes.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "cliente.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: id,
    metadata: { acao: "reativado" },
  });

  revalidatePath("/clientes");
  return { ok: true, id };
}
