"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import { clienteProdutoSchema } from "@/lib/validations/cliente-produtos";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/** Mensagem única do produto padrão — usada tanto no gate da action
 *  quanto na tradução do erro do trigger, que é a última barreira. */
const PRODUTO_PADRAO_BLOQUEADO =
  "Este produto representa a marca do cliente e não pode ser alterado. Para renomeá-lo, edite o nome fantasia do cliente.";

function mapProdutoDbError(msg: string): string {
  if (msg.includes("produto_padrao_protegido")) {
    return PRODUTO_PADRAO_BLOQUEADO;
  }
  if (msg.includes("uniq_cliente_produto_nome")) {
    return "Este cliente já tem um produto com esse nome.";
  }
  if (msg.includes("uniq_cliente_produto_codigo")) {
    return "Código já usado neste cliente — tente novamente.";
  }
  if (msg.includes("cliente_produtos_nome_nao_vazio")) {
    return "Nome do produto não pode ficar vazio.";
  }
  return "Não foi possível salvar o produto.";
}

/**
 * O produto padrão é imutável. O banco já barra via trigger; este gate
 * existe para devolver a mensagem certa antes de gastar o round-trip e
 * para registrar a tentativa na auditoria.
 */
async function assertNaoEhPadrao(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  clienteId: string,
  produtoId: string,
  acaoTentada: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data } = await supabase
    .from("cliente_produtos")
    .select("padrao")
    .eq("id", produtoId)
    .eq("cliente_id", clienteId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ padrao: boolean }>();

  if (!data) return { ok: false, message: "Produto não encontrado." };
  if (!data.padrao) return { ok: true };

  await logAuditEvent({
    acao: "acao_negada",
    tenantId,
    entidadeTipo: "cliente_produto",
    entidadeId: produtoId,
    metadata: { acao_tentada: acaoTentada, motivo: "produto_padrao_protegido" },
  });

  return { ok: false, message: PRODUTO_PADRAO_BLOQUEADO };
}

/**
 * Próximo código do cliente no formato PRD-NN. Conta os produtos já
 * cadastrados (inclusive inativos, pra não reciclar código de produto
 * arquivado). Sujeito a corrida — o unique index captura a colisão.
 */
async function gerarCodigoProduto(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  clienteId: string,
): Promise<string> {
  const { count, error } = await supabase
    .from("cliente_produtos")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("cliente_id", clienteId);

  if (error) throw new Error(`Falha ao contar produtos: ${error.message}`);

  const seq = ((count ?? 0) + 1).toString().padStart(2, "0");
  return `PRD-${seq}`;
}

export async function criarProduto(
  clienteId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = clienteProdutoSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  let codigo: string;
  try {
    codigo = await gerarCodigoProduto(supabase, session.activeTenant.id, clienteId);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const { data, error } = await supabase
    .from("cliente_produtos")
    .insert({
      tenant_id: session.activeTenant.id,
      cliente_id: clienteId,
      nome: parsed.data.nome,
      codigo,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[cliente_produtos.criar]", error.message);
    return { ok: false, message: mapProdutoDbError(error.message) };
  }

  await logAuditEvent({
    acao: "cliente_produto.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente_produto",
    entidadeId: data.id,
    metadata: { cliente_id: clienteId, nome: parsed.data.nome, codigo },
  });

  revalidatePath(`/clientes/${clienteId}`);
  return { ok: true, id: data.id };
}

export async function editarProduto(
  clienteId: string,
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = clienteProdutoSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const gate = await assertNaoEhPadrao(
    supabase,
    session.activeTenant.id,
    clienteId,
    id,
    "cliente_produto.editado",
  );
  if (!gate.ok) return gate;

  // Código não muda no editar: ele identifica o produto no histórico.
  const { error } = await supabase
    .from("cliente_produtos")
    .update({ nome: parsed.data.nome })
    .eq("id", id)
    .eq("cliente_id", clienteId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[cliente_produtos.editar]", error.message);
    return { ok: false, message: mapProdutoDbError(error.message) };
  }

  await logAuditEvent({
    acao: "cliente_produto.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente_produto",
    entidadeId: id,
    metadata: { cliente_id: clienteId, nome: parsed.data.nome },
  });

  revalidatePath(`/clientes/${clienteId}`);
  return { ok: true, id };
}

async function alternarAtivo(
  clienteId: string,
  id: string,
  ativo: boolean,
): Promise<ActionResult> {
  const session = await requireSession();

  const supabase = createClient();

  const gate = await assertNaoEhPadrao(
    supabase,
    session.activeTenant.id,
    clienteId,
    id,
    ativo ? "cliente_produto.reativado" : "cliente_produto.inativado",
  );
  if (!gate.ok) return gate;

  const { error } = await supabase
    .from("cliente_produtos")
    .update({ ativo })
    .eq("id", id)
    .eq("cliente_id", clienteId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[cliente_produtos.ativo]", error.message);
    return {
      ok: false,
      message: error.message.includes("produto_padrao_protegido")
        ? PRODUTO_PADRAO_BLOQUEADO
        : ativo
          ? "Não foi possível reativar."
          : "Não foi possível inativar.",
    };
  }

  await logAuditEvent({
    acao: ativo ? "cliente_produto.reativado" : "cliente_produto.inativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente_produto",
    entidadeId: id,
    metadata: { cliente_id: clienteId },
  });

  revalidatePath(`/clientes/${clienteId}`);
  return { ok: true, id };
}

export async function inativarProduto(clienteId: string, id: string) {
  return alternarAtivo(clienteId, id, false);
}

export async function reativarProduto(clienteId: string, id: string) {
  return alternarAtivo(clienteId, id, true);
}
