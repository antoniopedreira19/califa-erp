"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { orcamentoSchema } from "@/lib/validations/orcamentos";
import { gerarCodigoOrcamento } from "@/lib/codigos/orcamentos";
import { honorariosDoOrcamento } from "@/lib/data/clientes";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function extractInput(formData: FormData) {
  return {
    codigo: formData.get("codigo")?.toString() ?? "",
    nome: formData.get("nome")?.toString() ?? "",
    status: (formData.get("status")?.toString() ?? "rascunho") as any,
    categoria_id: formData.get("categoria_id")?.toString() ?? "",
    regional_id: formData.get("regional_id")?.toString() ?? "",
    cidade_id: formData.get("cidade_id")?.toString() ?? "",
    gp_responsavel_id: formData.get("gp_responsavel_id")?.toString() ?? "",
    produtor_id: formData.get("produtor_id")?.toString() ?? "",
    data_inicio_prevista: formData.get("data_inicio_prevista")?.toString() ?? "",
    data_fim_prevista: formData.get("data_fim_prevista")?.toString() ?? "",
  };
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_orcamentos_codigo_por_tenant")) {
    return "Já existe um orçamento com este código neste tenant.";
  }
  if (msg.includes("orcamentos_datas_ordem")) {
    return "Data fim precisa ser igual ou posterior à data início.";
  }
  if (msg.includes("orcamentos_regional_id_fkey")) {
    return "Regional inválida.";
  }
  if (msg.includes("orcamentos_cidade_id_fkey")) {
    return "Cidade inválida.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

async function assertProjetoDoTenant(
  supabase: ReturnType<typeof createClient>,
  projetoId: string,
  tenantId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("projetos")
    .select("id")
    .eq("id", projetoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, message: "Projeto não encontrado." };
  }
  return { ok: true };
}

/**
 * Regional e GP do orçamento têm que sair do projeto — o formulário já
 * mostra só essas opções, mas quem posta o form pode mandar outra coisa.
 * A FK não cobre isso: ela só garante que a regional existe no cadastro.
 */
async function assertRegionalEGpDoProjeto(
  supabase: ReturnType<typeof createClient>,
  projetoId: string,
  tenantId: string,
  regionalId: string,
  gpId: string,
): Promise<{ ok: true } | { ok: false; message: string; fieldErrors?: Record<string, string[]> }> {
  const [regRes, gpRes] = await Promise.all([
    supabase
      .from("projeto_regionais")
      .select("regional_id")
      .eq("projeto_id", projetoId)
      .eq("regional_id", regionalId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("projeto_responsaveis")
      .select("profile_id")
      .eq("projeto_id", projetoId)
      .eq("profile_id", gpId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (!regRes.data) {
    return {
      ok: false,
      message: "Regional inválida para este projeto.",
      fieldErrors: { regional_id: ["Escolha uma das regionais do projeto."] },
    };
  }
  if (!gpRes.data) {
    return {
      ok: false,
      message: "GP responsável inválido para este projeto.",
      fieldErrors: {
        gp_responsavel_id: ["Escolha um dos responsáveis do projeto."],
      },
    };
  }
  return { ok: true };
}

export async function criarOrcamento(
  projetoId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = orcamentoSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const chk = await assertProjetoDoTenant(supabase, projetoId, session.activeTenant.id);
  if (!chk.ok) return chk;

  const vinculo = await assertRegionalEGpDoProjeto(
    supabase,
    projetoId,
    session.activeTenant.id,
    parsed.data.regional_id,
    parsed.data.gp_responsavel_id,
  );
  if (!vinculo.ok) return vinculo;

  let codigo: string;
  try {
    codigo = parsed.data.codigo ?? (await gerarCodigoOrcamento(supabase, projetoId, session.activeTenant.id));
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const { codigo: _unused, ...rest } = parsed.data;

  const { data, error } = await supabase
    .from("orcamentos")
    .insert({
      ...rest,
      codigo,
      projeto_id: projetoId,
      tenant_id: session.activeTenant.id,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[orcamentos.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "orcamento.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "orcamento",
    entidadeId: data.id,
    metadata: { codigo, nome: parsed.data.nome, projeto_id: projetoId },
  });

  revalidatePath(`/orcamentos/${projetoId}`);

  // A V1 nasce junto com o orçamento e o usuário cai direto na planilha
  // (decisão do time, 13/08/2026). Antes, criar um orçamento levava para
  // uma lista de versões vazia e exigia um segundo passo — "Nova versão"
  // — que nunca teve escolha real: a primeira versão de um orçamento novo
  // é sempre a v1 em rascunho.
  //
  // Sem alíquota de propósito: escolher imposto é decisão de fechamento,
  // não de abertura, e quem cobra é a aprovação (docs/decisions/006).
  const versaoId = await criarVersaoInicial(data.id, session.activeTenant.id, session.profile.id);

  if (!versaoId) {
    // O orçamento existe e é válido sem versão — é o estado que a tela de
    // versões já sabe mostrar. Cair nela é o degrau seguro: refazer o
    // formulário criaria um orçamento duplicado.
    redirect(`/orcamentos/${projetoId}/${data.id}`);
  }

  redirect(`/orcamentos/${projetoId}/${data.id}/versoes/${versaoId}`);
}

/** Cria a v1 em rascunho de um orçamento recém-criado.
 *
 *  Devolve o id, ou `null` quando não deu — e aí quem chama decide o
 *  destino. Não usa `criarVersao`: aquela é a porta do formulário, com
 *  validação de status e redirect próprio, e chamá-la de dentro daqui
 *  significaria capturar o redirect dela para descartar. */
async function criarVersaoInicial(
  orcamentoId: string,
  tenantId: string,
  profileId: string,
): Promise<string | null> {
  const supabase = createClient();

  // Honorários vêm do cadastro do cliente, como em toda criação de versão.
  // Sem eles a conta de fechamento sai errada e em silêncio, então é
  // preferível abrir sem versão a abrir com uma versão de base errada.
  const honorarios = await honorariosDoOrcamento(orcamentoId, tenantId);
  if (!honorarios) {
    console.error("[orcamentos.criar.v1] honorários do cliente não lidos", {
      orcamentoId,
    });
    return null;
  }

  const { data, error } = await supabase
    .from("versoes_orcamento")
    .insert({
      tenant_id: tenantId,
      orcamento_id: orcamentoId,
      numero_versao: 1,
      status: "rascunho",
      moeda: "BRL",
      taxa_cambio: 1,
      percentual_honorarios: honorarios.percentual,
      percentual_imposto: 0,
      created_by: profileId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    console.error("[orcamentos.criar.v1]", error?.message);
    return null;
  }

  await logAuditEvent({
    acao: "versao_orcamento.criada",
    tenantId,
    entidadeTipo: "versao_orcamento",
    entidadeId: data.id,
    metadata: { orcamento_id: orcamentoId, numero_versao: 1, origem: "criacao_orcamento" },
  });

  return data.id;
}

export async function atualizarOrcamento(
  projetoId: string,
  orcId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = orcamentoSchema.safeParse(extractInput(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();

  const { data: atual } = await supabase
    .from("orcamentos")
    .select("status")
    .eq("id", orcId)
    .eq("projeto_id", projetoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ status: string }>();

  if (!atual) {
    return { ok: false, message: "Orçamento não encontrado." };
  }
  if (atual.status === "aprovado" || atual.status === "job_criado") {
    return {
      ok: false,
      message:
        "Orçamento em estado protegido (aprovado ou com job criado). Alterações precisam ser feitas pela Task 004/005.",
    };
  }

  const vinculo = await assertRegionalEGpDoProjeto(
    supabase,
    projetoId,
    session.activeTenant.id,
    parsed.data.regional_id,
    parsed.data.gp_responsavel_id,
  );
  if (!vinculo.ok) return vinculo;

  const { codigo, ...rest } = parsed.data;
  const payload = codigo ? { ...rest, codigo } : rest;

  const { error } = await supabase
    .from("orcamentos")
    .update(payload)
    .eq("id", orcId)
    .eq("projeto_id", projetoId)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[orcamentos.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "orcamento.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "orcamento",
    entidadeId: orcId,
  });

  revalidatePath(`/orcamentos/${projetoId}`);
  revalidatePath(`/orcamentos/${projetoId}/${orcId}`);
  return { ok: true, id: orcId };
}
