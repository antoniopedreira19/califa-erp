"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { freelancerSchema } from "@/lib/validations/freelancers";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Admin, RH e Financeiro podem cadastrar/editar freelancer. GP e
 * produtor leem via RLS (SELECT policy permite tenant_member) mas não
 * passam pela policy de INSERT/UPDATE.
 */
function podeEscrever(role: string): boolean {
  return role === "administrador" || role === "rh" || role === "financeiro";
}

/**
 * Lê FormData e aplica o schema. Normalização (dígitos puros, trim) é feita
 * pelo Zod via `.transform()`. Campos vazios viram null — o schema trata.
 */
function parseFormData(formData: FormData) {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string") raw[k] = v;
  }
  return freelancerSchema.safeParse(raw);
}

type ErroTratado = {
  message: string;
  fieldErrors?: Record<string, string[]>;
};

function tratarErroPostgres(
  code: string | undefined,
  constraint: string | undefined,
): ErroTratado | null {
  if (code === "23505") {
    if (constraint?.includes("cpf")) {
      return {
        message: "Já existe um freelancer com esse CPF",
        fieldErrors: { cpf: ["CPF já cadastrado"] },
      };
    }
    if (constraint?.includes("cnpj")) {
      return {
        message: "Já existe um freelancer com esse CNPJ",
        fieldErrors: { cnpj: ["CNPJ já cadastrado"] },
      };
    }
    return { message: "Registro duplicado" };
  }
  if (code === "23514") {
    if (constraint === "freelancers_cnpj_razao_social_par") {
      return {
        message: "CNPJ e Razão Social precisam ser preenchidos juntos",
        fieldErrors: {
          cnpj: ["Preenchimento obrigatório em par com Razão Social"],
          razao_social: ["Preenchimento obrigatório em par com CNPJ"],
        },
      };
    }
    return { message: "Dados fora das regras do banco" };
  }
  return null;
}

export async function criarFreelancer(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  if (!podeEscrever(session.activeRole)) {
    return { ok: false, message: "Sem permissão para cadastrar freelancer" };
  }

  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Dados inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("freelancers")
    .insert({
      ...parsed.data,
      tenant_id: session.activeTenant.id,
      origem: "manual",
      created_by: session.profile.id,
      updated_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    const tratado = tratarErroPostgres(error.code, error.message);
    if (tratado) return { ok: false, ...tratado };
    console.error("[freelancers.criar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer",
    entidadeId: data.id,
    metadata: {
      nome_social: parsed.data.nome_social,
      cpf: parsed.data.cpf,
    },
  });

  revalidatePath("/freelancers/lista");
  redirect(`/freelancers/${data.id}`);
}

/**
 * Fluxo integrado portado do RH antigo: cria freelancer + contrato na mesma
 * transação lógica. Também sobe o cartão CNPJ se vier arquivo. Dedup por CPF:
 * se já existe freela com esse CPF, atualiza os campos "frescos" (contato,
 * endereço, bancário) e cria contrato apontando pro existente.
 *
 * Diferente do `criarFreelancer` (freelancer só): esta action força banco/
 * agência/conta como obrigatórios (PIX fica opcional), aceita um `File` de
 * cartão CNPJ, e exige dados completos de contrato (job, cargo, valor, tipo,
 * datas, cidade, responsável).
 */
export async function criarFreelancerCompleto(
  formData: FormData,
): Promise<ActionResult<{ freelancer_id: string }>> {
  const session = await requireSession();
  if (!podeEscrever(session.activeRole)) {
    return { ok: false, message: "Sem permissão para cadastrar freelancer" };
  }

  // 1. Validação do freelancer (reusa o schema padrão com tipo_pagamento
  //    forçado em conta_bancaria pra passar a validação de banco/agência/conta).
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string") raw[k] = v;
  }
  raw.tipo_pagamento = "conta_bancaria"; // sempre obrig. pelo fluxo integrado
  const parsedFreela = freelancerSchema.safeParse(raw);
  if (!parsedFreela.success) {
    return {
      ok: false,
      message: "Dados do freelancer inválidos",
      fieldErrors: parsedFreela.error.flatten().fieldErrors,
    };
  }

  // 2. Validação dos campos extras (contrato + responsável) feita inline
  //    porque é um fluxo específico.
  const responsavel_id = raw.responsavel_id?.trim() ?? "";
  const job_id = raw.job_id?.trim() ?? "";
  const cargo_contrato = raw.cargo_contrato?.trim() ?? "";
  const valor_centavos = Number(raw.valor_centavos ?? "0");
  const tipo = raw.tipo_contrato?.trim() ?? "";
  const data_inicio_contrato = raw.data_inicio_contrato?.trim() ?? "";
  const data_termino_contrato = raw.data_termino_contrato?.trim() ?? "";
  const cidade_contrato = raw.cidade_contrato?.trim() ?? "";

  const errosContrato: Record<string, string[]> = {};
  if (!/^[0-9a-f-]{36}$/i.test(responsavel_id))
    errosContrato.responsavel_id = ["Selecione o responsável"];
  if (!/^[0-9a-f-]{36}$/i.test(job_id))
    errosContrato.job_id = ["Selecione um job"];
  if (!cargo_contrato) errosContrato.cargo_contrato = ["Cargo obrigatório"];
  if (!Number.isFinite(valor_centavos) || valor_centavos <= 0)
    errosContrato.valor_centavos = ["Valor inválido"];
  if (!["mensal", "periodo", "diarias"].includes(tipo))
    errosContrato.tipo_contrato = ["Escolha o tipo"];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data_inicio_contrato))
    errosContrato.data_inicio_contrato = ["Data de início obrigatória"];
  if (
    data_termino_contrato &&
    !/^\d{4}-\d{2}-\d{2}$/.test(data_termino_contrato)
  ) {
    errosContrato.data_termino_contrato = ["Data de término inválida"];
  }
  if (!cidade_contrato) errosContrato.cidade_contrato = ["Cidade obrigatória"];

  if (Object.keys(errosContrato).length > 0) {
    return {
      ok: false,
      message: "Dados do contrato inválidos",
      fieldErrors: errosContrato,
    };
  }

  const supabase = createClient();
  const dadosFreela = parsedFreela.data;

  // 3. Dedup por CPF: se já existe, reusa.
  let freelancer_id: string;
  let ja_existia = false;
  if (dadosFreela.cpf) {
    const { data: existente } = await supabase
      .from("freelancers")
      .select("id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("cpf", dadosFreela.cpf)
      .maybeSingle();
    if (existente?.id) {
      freelancer_id = existente.id;
      ja_existia = true;
      // Atualiza conservador: só o que normalmente vem fresco (contato,
      // endereço, bancário).
      await supabase
        .from("freelancers")
        .update({
          email: dadosFreela.email ?? undefined,
          celular: dadosFreela.celular ?? undefined,
          cep: dadosFreela.cep ?? undefined,
          rua: dadosFreela.rua ?? undefined,
          numero: dadosFreela.numero ?? undefined,
          complemento: dadosFreela.complemento ?? undefined,
          bairro: dadosFreela.bairro ?? undefined,
          cidade: dadosFreela.cidade ?? undefined,
          cnpj: dadosFreela.cnpj ?? undefined,
          razao_social: dadosFreela.razao_social ?? undefined,
          tipo_pagamento: "conta_bancaria",
          banco: dadosFreela.banco ?? undefined,
          agencia: dadosFreela.agencia ?? undefined,
          conta: dadosFreela.conta ?? undefined,
          tipo_conta: dadosFreela.tipo_conta ?? undefined,
          pix_chave: dadosFreela.pix_chave ?? undefined,
          // Decisão 212: a chave nova vem com o tipo dela.
          pix_tipo: dadosFreela.pix_chave ? (dadosFreela.pix_tipo ?? null) : undefined,
          updated_by: session.profile.id,
        })
        .eq("id", freelancer_id);
    }
  }

  if (!ja_existia) {
    const { data, error } = await supabase
      .from("freelancers")
      .insert({
        ...dadosFreela,
        tenant_id: session.activeTenant.id,
        origem: "manual",
        created_by: session.profile.id,
        updated_by: session.profile.id,
      })
      .select("id")
      .single();
    if (error) {
      const tratado = tratarErroPostgres(error.code, error.message);
      if (tratado) return { ok: false, ...tratado };
      console.error("[freelancers.criar_completo]", error.message);
      return { ok: false, message: error.message };
    }
    freelancer_id = data.id;
  }

  // 4. Upload do cartão CNPJ se veio arquivo
  const cartaoCnpjFile = formData.get("cartao_cnpj_file");
  if (cartaoCnpjFile instanceof File && cartaoCnpjFile.size > 0) {
    const ext =
      cartaoCnpjFile.name.split(".").pop()?.toLowerCase() || "bin";
    const path = `${session.activeTenant.id}/freelancers/${freelancer_id!}/cartao-cnpj.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("freelancer-arquivos")
      .upload(path, cartaoCnpjFile, { upsert: true });
    if (!upErr) {
      await supabase
        .from("freelancers")
        .update({ cartao_cnpj_url: path })
        .eq("id", freelancer_id!);
    }
    // Erro no upload é logado mas não trava o fluxo — RH pode anexar depois.
    if (upErr) console.error("[freelancers.upload_cartao]", upErr.message);
  }

  // 5. Snapshot do nome do job
  const { data: job } = await supabase
    .from("jobs")
    .select("nome")
    .eq("id", job_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  const nome_job = job?.nome ?? "Importado (sem job vinculado)";

  // 6. Cria o contrato
  const { error: errContrato } = await supabase
    .from("freelancer_contratos")
    .insert({
      tenant_id: session.activeTenant.id,
      freelancer_id: freelancer_id!,
      job_id,
      responsavel_id,
      nome_job,
      cargo: cargo_contrato,
      tipo,
      valor: valor_centavos / 100,
      data_inicio: data_inicio_contrato,
      data_termino: data_termino_contrato || null,
      cidade: cidade_contrato,
      status_real: true,
      origem_sistema: "califa_erp",
      created_by: session.profile.id,
      updated_by: session.profile.id,
    });
  if (errContrato) {
    console.error("[freelancers.criar_contrato]", errContrato.message);
    return { ok: false, message: errContrato.message };
  }

  await logAuditEvent({
    acao: "freelancer.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer",
    entidadeId: freelancer_id!,
    metadata: {
      nome_social: dadosFreela.nome_social,
      cpf: dadosFreela.cpf,
      ja_existia,
      com_contrato: true,
    },
  });

  revalidatePath("/freelancers/lista");
  revalidatePath("/freelancers");
  return { ok: true, data: { freelancer_id: freelancer_id! } };
}

const ACOES_VALIDAS = new Set([
  "contratar",
  "renovar",
  "manter",
  "substituir",
  "encerrar",
]);

/** Toggle inline de ação prevista — admin/rh/financeiro apenas. */
export async function atualizarAcaoPrevista(
  id: string,
  acao: string | null,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!podeEscrever(session.activeRole)) {
    return { ok: false, message: "Sem permissão" };
  }

  if (acao !== null && !ACOES_VALIDAS.has(acao)) {
    return { ok: false, message: "Ação inválida" };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("freelancers")
    .update({
      acao_prevista: acao,
      updated_by: session.profile.id,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[freelancer.acao_prevista]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer.acao_prevista_alterada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer",
    entidadeId: id,
    metadata: { acao_prevista: acao },
  });

  revalidatePath("/freelancers/lista");
  revalidatePath(`/freelancers/${id}`);
  return { ok: true };
}

export async function atualizarFreelancer(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!podeEscrever(session.activeRole)) {
    return { ok: false, message: "Sem permissão para editar freelancer" };
  }

  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Dados inválidos",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("freelancers")
    .update({
      ...parsed.data,
      updated_by: session.profile.id,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    const tratado = tratarErroPostgres(error.code, error.message);
    if (tratado) return { ok: false, ...tratado };
    console.error("[freelancers.atualizar]", error.message);
    return { ok: false, message: error.message };
  }

  await logAuditEvent({
    acao: "freelancer.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "freelancer",
    entidadeId: id,
    metadata: {
      nome_social: parsed.data.nome_social,
    },
  });

  revalidatePath("/freelancers/lista");
  revalidatePath(`/freelancers/${id}`);
  return { ok: true };
}
