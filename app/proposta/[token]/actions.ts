"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import {
  salvarDadosCandidatoSchema,
  motivoTextoSchema,
} from "@/lib/validations/rh-contratacoes";
import type { ContratacaoStatus } from "@/lib/types";

/**
 * Actions da página pública /proposta/[token]. Rodam com service_role
 * client (bypassam RLS) porque o candidato NÃO tem login no ERP.
 * A segurança é o token opaco 32+ chars + expiração.
 *
 * Regras universais:
 *   - Toda action valida token + expiração antes de tocar em qualquer
 *     coisa.
 *   - Só afetam UMA contratação (a que casa com o token).
 *   - Se o status atual não é o esperado, retornam erro sem alterar
 *     nada — evita "acidente" de o candidato clicar 2× e pular etapa.
 */

type PublicActionResult = { ok: true } | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

async function acharPorToken(token: string) {
  if (!token || token.length < 32) return null;
  const service = createServiceClient();
  const { data } = await service
    .from("contratacoes")
    .select(
      "id, status, token_expira_em, tipo_contratacao, tenant_id",
    )
    .eq("token", token)
    .maybeSingle();
  return data;
}

function estaExpirado(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

/** Candidato aceita a proposta. status: proposta_enviada → aceite_recebido */
export async function aceitarProposta(
  token: string,
): Promise<PublicActionResult> {
  const c = await acharPorToken(token);
  if (!c) return { ok: false, message: "Link inválido." };
  if (estaExpirado(c.token_expira_em))
    return { ok: false, message: "Link expirado. Procure o RH." };
  if (c.status !== "proposta_enviada") {
    return {
      ok: false,
      message: "Esta proposta não está mais aguardando resposta.",
    };
  }

  const service = createServiceClient();
  const { error } = await service
    .from("contratacoes")
    .update({
      status: "aceite_recebido",
      aceite_em: new Date().toISOString(),
    })
    .eq("id", c.id)
    .eq("status", "proposta_enviada");
  if (error) return { ok: false, message: "Não foi possível registrar o aceite." };

  revalidatePath(`/proposta/${token}`);
  revalidatePath(`/rh/contratacoes/${c.id}`);
  return { ok: true };
}

/** Candidato recusa a proposta. status: proposta_enviada → recusada */
export async function recusarProposta(
  token: string,
  formData: FormData,
): Promise<PublicActionResult> {
  const c = await acharPorToken(token);
  if (!c) return { ok: false, message: "Link inválido." };
  if (estaExpirado(c.token_expira_em))
    return { ok: false, message: "Link expirado. Procure o RH." };
  if (c.status !== "proposta_enviada") {
    return {
      ok: false,
      message: "Esta proposta não está mais aguardando resposta.",
    };
  }

  const parsed = motivoTextoSchema.safeParse({
    motivo: formData.get("motivo")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Escreva o motivo (mínimo 3 caracteres).",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const service = createServiceClient();
  const { error } = await service
    .from("contratacoes")
    .update({
      status: "recusada",
      motivo_recusa: parsed.data.motivo,
    })
    .eq("id", c.id)
    .eq("status", "proposta_enviada");
  if (error) return { ok: false, message: "Não foi possível registrar a recusa." };

  revalidatePath(`/proposta/${token}`);
  revalidatePath(`/rh/contratacoes/${c.id}`);
  return { ok: true };
}

/**
 * Candidato preenche todos os dados. status: aceite_recebido → dados_completos
 * Valida CPF sempre, CNPJ + razão social se PJ, endereço completo pra todos,
 * meio de pagamento (conta OU PIX).
 */
export async function salvarDadosCandidato(
  token: string,
  formData: FormData,
): Promise<PublicActionResult> {
  const c = await acharPorToken(token);
  if (!c) return { ok: false, message: "Link inválido." };
  if (estaExpirado(c.token_expira_em))
    return { ok: false, message: "Link expirado. Procure o RH." };
  if (c.status !== "aceite_recebido") {
    return {
      ok: false,
      message:
        "Não é mais possível editar os dados. Se precisar corrigir, procure o RH.",
    };
  }

  const parsed = salvarDadosCandidatoSchema.safeParse({
    cpf: formData.get("cpf")?.toString() ?? "",
    cnpj: formData.get("cnpj")?.toString() ?? "",
    razao_social: formData.get("razao_social")?.toString() ?? "",
    rg: formData.get("rg")?.toString() ?? "",
    telefone: formData.get("telefone")?.toString() ?? "",
    data_nascimento: formData.get("data_nascimento")?.toString() ?? "",
    cep: formData.get("cep")?.toString() ?? "",
    logradouro: formData.get("logradouro")?.toString() ?? "",
    numero: formData.get("numero")?.toString() ?? "",
    complemento: formData.get("complemento")?.toString() ?? "",
    bairro: formData.get("bairro")?.toString() ?? "",
    cidade: formData.get("cidade")?.toString() ?? "",
    uf: formData.get("uf")?.toString() ?? "",
    banco_codigo: formData.get("banco_codigo")?.toString() ?? "",
    banco_nome: formData.get("banco_nome")?.toString() ?? "",
    agencia: formData.get("agencia")?.toString() ?? "",
    agencia_dv: formData.get("agencia_dv")?.toString() ?? "",
    conta: formData.get("conta")?.toString() ?? "",
    conta_dv: formData.get("conta_dv")?.toString() ?? "",
    tipo_conta: formData.get("tipo_conta")?.toString() || undefined,
    pix_tipo: formData.get("pix_tipo")?.toString() || undefined,
    pix_chave: formData.get("pix_chave")?.toString() ?? "",
    _tipo_contratacao: c.tipo_contratacao,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const service = createServiceClient();
  const { error } = await service
    .from("contratacoes")
    .update({
      cpf: parsed.data.cpf,
      cnpj: parsed.data.cnpj,
      razao_social: parsed.data.razao_social,
      rg: parsed.data.rg,
      telefone: parsed.data.telefone,
      data_nascimento: parsed.data.data_nascimento,
      cep: parsed.data.cep,
      logradouro: parsed.data.logradouro,
      numero: parsed.data.numero,
      complemento: parsed.data.complemento,
      bairro: parsed.data.bairro,
      cidade: parsed.data.cidade,
      uf: parsed.data.uf,
      banco_codigo: parsed.data.banco_codigo,
      banco_nome: parsed.data.banco_nome,
      agencia: parsed.data.agencia,
      agencia_dv: parsed.data.agencia_dv,
      conta: parsed.data.conta,
      conta_dv: parsed.data.conta_dv,
      tipo_conta: parsed.data.tipo_conta,
      pix_tipo: parsed.data.pix_tipo,
      pix_chave: parsed.data.pix_chave,
      status: "dados_completos",
      dados_completados_em: new Date().toISOString(),
    })
    .eq("id", c.id)
    .eq("status", "aceite_recebido");
  if (error) {
    console.error("[proposta.salvar_dados]", error.message);
    return {
      ok: false,
      message: "Não foi possível salvar. Se persistir, procure o RH.",
    };
  }

  revalidatePath(`/proposta/${token}`);
  revalidatePath(`/rh/contratacoes/${c.id}`);
  return { ok: true };
}

/**
 * Utilitário: marca contratações como `expirada` quando o token venceu
 * e ainda não foi decidido. É chamada pela server component da lista
 * do RH sempre que carregar — barato o suficiente pra rodar lazy sem
 * precisar de cron nesta v1.
 */
export async function expirarContratacoesVencidas(tenantId: string) {
  const service = createServiceClient();
  const statusExpirables: ContratacaoStatus[] = [
    "proposta_enviada",
    "aceite_recebido",
  ];
  await service
    .from("contratacoes")
    .update({ status: "expirada" })
    .eq("tenant_id", tenantId)
    .lt("token_expira_em", new Date().toISOString())
    .in("status", statusExpirables);
}
