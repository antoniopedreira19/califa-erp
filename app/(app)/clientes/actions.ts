"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { clienteSchema } from "@/lib/validations/clientes";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  return {
    nome_fantasia: formData.get("nome_fantasia")?.toString() ?? "",
    codigo_curto: formData.get("codigo_curto")?.toString() ?? "",
    razao_social: formData.get("razao_social")?.toString() ?? "",
    cnpj: formData.get("cnpj")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    telefone: formData.get("telefone")?.toString() ?? "",
    observacoes: formData.get("observacoes")?.toString() ?? "",
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

  // Todo cliente nasce com um produto homônimo. Produto é obrigatório no
  // projeto desde 06/08/2026, e um cliente sem produto trava a criação de
  // projeto — o padrão evita esse beco. O GP renomeia ou acrescenta
  // outros depois, na tela do cliente.
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
  const parsed = clienteSchema.safeParse(extractInput(formData));

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
    .select("nome_fantasia")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ nome_fantasia: string }>();

  const { error } = await supabase
    .from("clientes")
    .update(parsed.data)
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[clientes.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "cliente.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: id,
  });

  // Renomear o cliente renomeia junto o produto que ainda carrega o nome
  // antigo — o `.eq("nome", ...)` é o que garante isso: produto já
  // ajustado à mão não casa e fica intacto. O nome é único por cliente,
  // então no máximo uma linha é afetada.
  const nomeMudou =
    anterior != null && anterior.nome_fantasia !== parsed.data.nome_fantasia;

  if (nomeMudou) {
    const { error: errRename } = await supabase
      .from("cliente_produtos")
      .update({ nome: parsed.data.nome_fantasia })
      .eq("cliente_id", id)
      .eq("tenant_id", session.activeTenant.id)
      .eq("nome", anterior!.nome_fantasia);

    // Falha aqui não desfaz a edição do cliente: o produto continua com
    // o nome antigo, que é um estado válido e editável na tela dele.
    // O caso esperado é colisão com outro produto de mesmo nome.
    if (errRename) {
      console.error("[clientes.atualizar.rename_produto]", errRename.message);
    }
  }

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${id}`);
  return { ok: true, id };
}

export async function inativarCliente(id: string): Promise<ActionResult> {
  const session = await requireSession();
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
