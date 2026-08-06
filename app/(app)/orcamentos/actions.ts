"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { projetoSchema } from "@/lib/validations/projetos";
import { gerarCodigoProjeto } from "@/lib/codigos/projetos";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  const base = {
    empresa_id: formData.get("empresa_id")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
    cliente_id: formData.get("cliente_id")?.toString() ?? "",
    produto_id: formData.get("produto_id")?.toString() ?? "",
    // `getAll` preserva a ordem de envio, e a ordem importa: o primeiro
    // item alimenta as colunas de compatibilidade em `projetos`.
    responsavel_ids: formData.getAll("responsavel_ids").map((v) => v.toString()),
    regional_ids: formData.getAll("regional_ids").map((v) => v.toString()),
    categoria_id: formData.get("categoria_id")?.toString() ?? "",
    data_inicio_prevista: formData.get("data_inicio_prevista")?.toString() ?? "",
    data_fim_prevista: formData.get("data_fim_prevista")?.toString() ?? "",
    descricao: formData.get("descricao")?.toString() ?? "",
  };
  // Campanha saiu do formulário (handoff 30/07/2026). Só entra no input
  // se o form realmente mandar o campo — ver `atualizarProjeto`.
  return formData.has("campanha")
    ? { ...base, campanha: formData.get("campanha")?.toString() ?? "" }
    : base;
}

function mapDbError(msg: string): string {
  if (msg.includes("projetos_empresa_id_fkey")) {
    return "Empresa inválida.";
  }
  if (msg.includes("uniq_projetos_codigo_por_tenant")) {
    return "Já existe um projeto com este código — tente novamente.";
  }
  if (msg.includes("projetos_cliente_id_fkey")) {
    return "Cliente inválido.";
  }
  if (msg.includes("projetos_responsavel_id_fkey")) {
    return "Responsável inválido.";
  }
  if (msg.includes("projeto_regionais_regional_id_fkey")) {
    return "Regional inválida.";
  }
  if (msg.includes("projetos_regional_id_fkey")) {
    return "Regional inválida.";
  }
  if (msg.includes("projeto_responsaveis_profile_id_fkey")) {
    return "Responsável inválido.";
  }
  if (msg.includes("projetos_produto_id_fkey")) {
    return "Produto inválido.";
  }
  if (msg.includes("projetos_fim_apos_inicio")) {
    return "A data final não pode ser anterior à data de início.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

/**
 * O produto é cadastrado por cliente e o banco não consegue garantir que
 * o escolhido pertence ao cliente do projeto — a FK só aponta para
 * `cliente_produtos`. A checagem é aqui, como já acontece na abertura de
 * job. Mesma ideia para as regionais: confirma que existem e estão ativas
 * no tenant antes de gravar os vínculos.
 */
async function validarProdutoERegionais(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  clienteId: string,
  produtoId: string,
  regionalIds: string[],
): Promise<{ ok: true } | { ok: false; message: string; fieldErrors?: Record<string, string[]> }> {
  const [produtoRes, regionaisRes] = await Promise.all([
    supabase
      .from("cliente_produtos")
      .select("id")
      .eq("id", produtoId)
      .eq("cliente_id", clienteId)
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .maybeSingle(),
    supabase
      .from("regionais")
      .select("id")
      .in("id", regionalIds)
      .eq("tenant_id", tenantId)
      .eq("ativo", true),
  ]);

  if (!produtoRes.data) {
    return {
      ok: false,
      message: "Produto inválido para este cliente.",
      fieldErrors: { produto_id: ["Selecione um produto do cadastro do cliente."] },
    };
  }
  if ((regionaisRes.data ?? []).length !== regionalIds.length) {
    return {
      ok: false,
      message: "Regional inválida.",
      fieldErrors: { regional_ids: ["Selecione regionais ativas do cadastro."] },
    };
  }
  return { ok: true };
}

/** Regrava os vínculos N:N do projeto. Apaga e reinsere: o conjunto é
 *  pequeno e o diff não pagaria a complexidade. */
async function sincronizarVinculos(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  projetoId: string,
  regionalIds: string[],
  responsavelIds: string[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const [delReg, delResp] = await Promise.all([
    supabase.from("projeto_regionais").delete().eq("projeto_id", projetoId).eq("tenant_id", tenantId),
    supabase.from("projeto_responsaveis").delete().eq("projeto_id", projetoId).eq("tenant_id", tenantId),
  ]);

  if (delReg.error || delResp.error) {
    console.error("[projetos.vinculos.delete]", delReg.error?.message ?? delResp.error?.message);
    return { ok: false, message: "Não foi possível gravar regionais e responsáveis." };
  }

  const [insReg, insResp] = await Promise.all([
    supabase.from("projeto_regionais").insert(
      regionalIds.map((regional_id) => ({
        projeto_id: projetoId,
        regional_id,
        tenant_id: tenantId,
      })),
    ),
    supabase.from("projeto_responsaveis").insert(
      responsavelIds.map((profile_id) => ({
        projeto_id: projetoId,
        profile_id,
        tenant_id: tenantId,
      })),
    ),
  ]);

  if (insReg.error || insResp.error) {
    const msg = insReg.error?.message ?? insResp.error?.message ?? "";
    console.error("[projetos.vinculos.insert]", msg);
    return { ok: false, message: mapDbError(msg) };
  }
  return { ok: true };
}

export async function criarProjeto(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = projetoSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const { regional_ids, responsavel_ids, ...campos } = parsed.data;

  const check = await validarProdutoERegionais(
    supabase,
    session.activeTenant.id,
    campos.cliente_id,
    campos.produto_id,
    regional_ids,
  );
  if (!check.ok) return check;

  let codigo: string;
  try {
    codigo = await gerarCodigoProjeto(
      supabase,
      session.activeTenant.id,
      parsed.data.cliente_id,
      parsed.data.data_inicio_prevista,
    );
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const { data, error } = await supabase
    .from("projetos")
    .insert({
      ...campos,
      // Colunas de compatibilidade: recebem o primeiro item de cada lista.
      // A fonte-verdade são `projeto_regionais` e `projeto_responsaveis`.
      responsavel_id: responsavel_ids[0],
      regional_id: regional_ids[0],
      codigo,
      tenant_id: session.activeTenant.id,
      // `created_by` registra quem cadastrou — pode não ser o responsável.
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[projetos.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  const vinculos = await sincronizarVinculos(
    supabase,
    session.activeTenant.id,
    data.id,
    regional_ids,
    responsavel_ids,
  );
  if (!vinculos.ok) return vinculos;

  await logAuditEvent({
    acao: "projeto.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "projeto",
    entidadeId: data.id,
    metadata: { codigo, nome: parsed.data.nome, cliente_id: parsed.data.cliente_id },
  });

  revalidatePath("/orcamentos");
  redirect(`/orcamentos/${data.id}`);
}

export async function atualizarProjeto(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = projetoSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const { regional_ids, responsavel_ids, ...campos } = parsed.data;

  const check = await validarProdutoERegionais(
    supabase,
    session.activeTenant.id,
    campos.cliente_id,
    campos.produto_id,
    regional_ids,
  );
  if (!check.ok) return check;

  // Campanha saiu do formulário mas a coluna e os dados continuam.
  // Não basta o campo ser opcional no Zod: o transform devolve `null`
  // para entrada ausente, então a chave entraria no UPDATE e zeraria o
  // valor gravado. Removemos explicitamente quando o form não a envia.
  const { campanha: _campanha, ...semCampanha } = campos;
  const base = formData.has("campanha") ? campos : semCampanha;
  const payload = {
    ...base,
    responsavel_id: responsavel_ids[0],
    regional_id: regional_ids[0],
  };

  // Confirma que o projeto pertence ao tenant do usuário (RLS já filtra,
  // mas explicitamos no where pra clareza).
  const { error } = await supabase
    .from("projetos")
    .update(payload)
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[projetos.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  const vinculos = await sincronizarVinculos(
    supabase,
    session.activeTenant.id,
    id,
    regional_ids,
    responsavel_ids,
  );
  if (!vinculos.ok) return vinculos;

  await logAuditEvent({
    acao: "projeto.atualizado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "projeto",
    entidadeId: id,
  });

  revalidatePath("/orcamentos");
  revalidatePath(`/orcamentos/${id}`);
  return { ok: true, id };
}

export async function arquivarProjeto(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  // Bloqueia se houver orçamento não-cancelado no projeto.
  const { count, error: errCount } = await supabase
    .from("orcamentos")
    .select("id", { count: "exact", head: true })
    .eq("projeto_id", id)
    .eq("tenant_id", session.activeTenant.id)
    .neq("status", "cancelado");

  if (errCount) {
    console.error("[projetos.arquivar.count]", errCount.message);
    return { ok: false, message: "Falha ao verificar orçamentos do projeto." };
  }

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: "Cancele todos os orçamentos do projeto antes de arquivar.",
    };
  }

  const { error } = await supabase
    .from("projetos")
    .update({ status: "arquivado" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[projetos.arquivar]", error.message);
    return { ok: false, message: "Não foi possível arquivar." };
  }

  await logAuditEvent({
    acao: "projeto.arquivado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "projeto",
    entidadeId: id,
  });

  revalidatePath("/orcamentos");
  revalidatePath(`/orcamentos/${id}`);
  return { ok: true, id };
}

export async function reativarProjeto(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase
    .from("projetos")
    .update({ status: "ativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[projetos.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "projeto.reativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "projeto",
    entidadeId: id,
  });

  revalidatePath("/orcamentos");
  revalidatePath(`/orcamentos/${id}`);
  return { ok: true, id };
}
