"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  fornecedorSchema,
  fornecedorCompletoSchema,
} from "@/lib/validations/fornecedores";
import { getBancoByCodigo } from "@/lib/dados/bancos-febraban";
import { onlyDigits } from "@/lib/utils";
import type { PixTipoChave } from "@/lib/types";

/** O que o combo de fornecedor precisa saber de um cadastro — é o que o
 *  cadastro rápido devolve para a PP selecionar sem esperar o refresh. */
export interface FornecedorResumo {
  id: string;
  nome: string;
  razao_social: string | null;
  status: "ativo" | "inativo";
}

export type ActionResult =
  | { ok: true; id?: string; fornecedor?: FornecedorResumo }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[]>;
      /** O documento já pertence a este cadastro (04/09/2026). A tela
       *  oferece selecioná-lo em vez de criar outro. */
      duplicado?: FornecedorResumo;
    };

function extractInput(formData: FormData) {
  return {
    // Campos existentes
    tipo_pessoa: formData.get("tipo_pessoa"),
    nome: formData.get("nome"),
    razao_social: formData.get("razao_social"),
    cpf_cnpj: formData.get("cpf_cnpj"),
    email: formData.get("email"),
    telefone: formData.get("telefone"),
    observacoes: formData.get("observacoes"),

    // Endereço
    cep: formData.get("cep"),
    logradouro: formData.get("logradouro"),
    numero: formData.get("numero"),
    complemento: formData.get("complemento"),
    bairro: formData.get("bairro"),
    cidade: formData.get("cidade"),
    uf: formData.get("uf"),

    // Banco
    banco_codigo: formData.get("banco_codigo"),
    agencia: formData.get("agencia"),
    agencia_dv: formData.get("agencia_dv"),
    conta: formData.get("conta"),
    conta_dv: formData.get("conta_dv"),
    tipo_conta: formData.get("tipo_conta"),

    // PIX
    pix_tipo: formData.get("pix_tipo"),
    pix_chave: formData.get("pix_chave"),
  };
}

function deriveBancoNome(
  banco_codigo: string | null | undefined,
): { ok: true; banco_nome: string | null } | { ok: false; message: string } {
  if (!banco_codigo) return { ok: true, banco_nome: null };
  const banco = getBancoByCodigo(banco_codigo);
  if (!banco) return { ok: false, message: "Banco selecionado é inválido." };
  return { ok: true, banco_nome: banco.nome };
}

function normalizePixChave(
  pix_tipo: string | null | undefined,
  pix_chave: string | null | undefined,
): string | null | undefined {
  if (!pix_tipo || !pix_chave) return pix_chave;
  switch (pix_tipo) {
    case "cpf":
    case "cnpj":
    case "telefone":
      return onlyDigits(pix_chave);
    case "email":
    case "aleatoria":
      return pix_chave.trim().toLowerCase();
    default:
      return pix_chave;
  }
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_fornecedores_documento_por_tenant")) {
    return "Já existe um fornecedor com este documento neste tenant.";
  }
  if (msg.includes("fornecedores_documento_formato")) {
    return "Documento não confere com o tipo de pessoa selecionado.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

/**
 * O miolo de criar um fornecedor: valida, deriva banco e PIX, insere e
 * audita. Dois callers — a página de cadastro (que redireciona) e o
 * cadastro rápido de dentro da PP (que devolve o registro para a tela
 * selecionar). O que muda entre eles é só o schema e o que fazer depois.
 */
async function inserirFornecedor(
  formData: FormData,
  schema: typeof fornecedorSchema | typeof fornecedorCompletoSchema,
  origem: "cadastro" | "pp",
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = schema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const bancoResult = deriveBancoNome(parsed.data.banco_codigo);
  if (!bancoResult.ok) {
    return { ok: false, message: bancoResult.message };
  }

  const pix_chave_normalizada = normalizePixChave(
    parsed.data.pix_tipo,
    parsed.data.pix_chave,
  );

  const supabase = createClient();

  // Documento repetido: a conferência ANTES do insert devolve quem já tem
  // o documento, para a tela oferecer selecioná-lo (04/09/2026). O índice
  // único `uniq_fornecedores_documento_por_tenant` continua sendo a
  // garantia — se dois cadastros correrem ao mesmo tempo, o segundo cai
  // no `mapDbError` abaixo.
  if (parsed.data.cpf_cnpj) {
    const existente = await buscarPorDocumento(
      supabase,
      session.activeTenant.id,
      parsed.data.cpf_cnpj,
    );
    if (existente) {
      return {
        ok: false,
        message: `Já existe um fornecedor com este ${
          parsed.data.tipo_pessoa === "fisica" ? "CPF" : "CNPJ"
        }: ${existente.razao_social ?? existente.nome}.`,
        fieldErrors: { cpf_cnpj: ["Documento já cadastrado."] },
        duplicado: existente,
      };
    }
  }

  const { data, error } = await supabase
    .from("fornecedores")
    .insert({
      ...parsed.data,
      banco_nome: bancoResult.banco_nome,
      pix_chave: pix_chave_normalizada,
      tenant_id: session.activeTenant.id,
      created_by: session.profile.id,
    })
    .select("id, nome, razao_social, status")
    .single();

  if (error) {
    console.error("[fornecedores.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "fornecedor.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: data.id,
    metadata: {
      nome: parsed.data.nome,
      tipo_pessoa: parsed.data.tipo_pessoa,
      origem,
    },
  });

  revalidatePath("/fornecedores");
  return {
    ok: true,
    id: data.id,
    fornecedor: {
      id: data.id,
      nome: data.nome,
      razao_social: data.razao_social ?? null,
      status: data.status as FornecedorResumo["status"],
    },
  };
}

async function buscarPorDocumento(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  documento: string,
  excludeId?: string,
): Promise<FornecedorResumo | null> {
  let query = supabase
    .from("fornecedores")
    .select("id, nome, razao_social, status")
    .eq("tenant_id", tenantId)
    .eq("cpf_cnpj", documento)
    .limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    nome: data.nome,
    razao_social: data.razao_social ?? null,
    status: data.status as FornecedorResumo["status"],
  };
}

export async function criarFornecedor(
  formData: FormData,
): Promise<ActionResult> {
  const res = await inserirFornecedor(formData, fornecedorSchema, "cadastro");
  if (!res.ok) return res;
  redirect("/fornecedores");
}

/**
 * Cadastro rápido de dentro do formulário de PP (04/09/2026, decisão 048).
 *
 * Exige documento, e-mail, telefone e um meio de pagamento
 * (`fornecedorCompletoSchema`) e devolve o registro criado, sem
 * redirecionar: quem chamou seleciona o fornecedor no combo e segue com
 * a PP.
 */
export async function criarFornecedorRapido(
  formData: FormData,
): Promise<ActionResult> {
  return inserirFornecedor(formData, fornecedorCompletoSchema, "pp");
}

/**
 * Já existe fornecedor com este CPF/CNPJ neste tenant? A tela pergunta
 * ao sair do campo, antes de a pessoa preencher o resto do cadastro.
 * Inativo também conta: o documento é um só, e o caminho é reativar.
 */
export async function buscarFornecedorPorDocumento(
  documento: string,
  excludeId?: string,
): Promise<{ existe: true; fornecedor: FornecedorResumo } | { existe: false }> {
  const digits = onlyDigits(documento ?? "");
  if (digits.length !== 11 && digits.length !== 14) return { existe: false };
  const session = await requireSession();
  const supabase = createClient();
  const existente = await buscarPorDocumento(
    supabase,
    session.activeTenant.id,
    digits,
    excludeId,
  );
  return existente ? { existe: true, fornecedor: existente } : { existe: false };
}

export async function atualizarFornecedor(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = fornecedorSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const bancoResult = deriveBancoNome(parsed.data.banco_codigo);
  if (!bancoResult.ok) {
    return { ok: false, message: bancoResult.message };
  }

  const pix_chave_normalizada = normalizePixChave(
    parsed.data.pix_tipo,
    parsed.data.pix_chave,
  );

  const supabase = createClient();
  const { error } = await supabase
    .from("fornecedores")
    .update({
      ...parsed.data,
      banco_nome: bancoResult.banco_nome,
      pix_chave: pix_chave_normalizada,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[fornecedores.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "fornecedor.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: id,
  });

  revalidatePath("/fornecedores");
  revalidatePath(`/fornecedores/${id}`);
  return { ok: true, id };
}

export async function verificarPixDuplicado(
  chave: string,
  pixTipo: PixTipoChave | null,
  excludeId?: string,
): Promise<{ existe: true; id: string; nome: string } | { existe: false }> {
  const chaveLimpa =
    pixTipo && chave
      ? normalizePixChave(pixTipo, chave) ?? chave.trim()
      : chave.trim();
  if (!chaveLimpa) return { existe: false };

  const supabase = createClient();

  let query = supabase
    .from("fornecedores")
    .select("id, nome")
    .eq("pix_chave", chaveLimpa)
    .eq("status", "ativo")
    .limit(1);

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return { existe: false };
  return { existe: true, id: data.id, nome: data.nome };
}

export async function inativarFornecedor(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase
    .from("fornecedores")
    .update({ status: "inativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[fornecedores.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar." };
  }

  await logAuditEvent({
    acao: "fornecedor.inativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: id,
  });

  revalidatePath("/fornecedores");
  return { ok: true, id };
}

export async function reativarFornecedor(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase
    .from("fornecedores")
    .update({ status: "ativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[fornecedores.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "fornecedor.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "fornecedor",
    entidadeId: id,
    metadata: { acao: "reativado" },
  });

  revalidatePath("/fornecedores");
  return { ok: true, id };
}
