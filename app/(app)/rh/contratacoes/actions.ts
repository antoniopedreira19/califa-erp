"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  criarContratacaoSchema,
  motivoTextoSchema,
} from "@/lib/validations/rh-contratacoes";
import type { Contratacao } from "@/lib/types";

type ActionResult<T = { id: string }> =
  | ({ ok: true } & T)
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const PRAZO_LINK_DIAS = 14;
const TIPOS_PJ_QUE_GERAM_CONTRATO = ["pj", "clt_recibo"];

function gerarToken(): string {
  // 24 bytes → 32 chars base64url (URL-safe, sem padding).
  return randomBytes(24).toString("base64url");
}

function prazoLink(): string {
  const d = new Date();
  d.setDate(d.getDate() + PRAZO_LINK_DIAS);
  return d.toISOString();
}

function mapDbError(msg: string): string {
  if (msg.includes("chk_contratacoes_cpf_formato")) {
    return "CPF em formato inválido.";
  }
  if (msg.includes("chk_contratacoes_cnpj_formato")) {
    return "CNPJ em formato inválido.";
  }
  if (msg.includes("chk_contratacoes_cep_formato")) {
    return "CEP em formato inválido.";
  }
  if (msg.includes("chk_contratacoes_telefone_formato")) {
    return "Telefone em formato inválido.";
  }
  if (msg.includes("fk_contratacao_regional_pertence_empresa")) {
    return "A regional escolhida não pertence à empresa selecionada.";
  }
  if (msg.includes("chk_contratacoes_efetivada_tem_colaborador")) {
    return "Contratação efetivada precisa ter colaborador vinculado.";
  }
  return "Não foi possível salvar a contratação.";
}

/**
 * Cria contratação em `rascunho`. Gera token opaco e prazo de 14 dias.
 */
export async function criarContratacao(
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.contratacoes.editar");
  if (!gate.ok) return gate;

  const parsed = criarContratacaoSchema.safeParse({
    nome: formData.get("nome")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    cargo: formData.get("cargo")?.toString() ?? "",
    salario_proposto: formData.get("salario_proposto")?.toString() ?? "",
    data_admissao: formData.get("data_admissao")?.toString() ?? "",
    empresa_id: formData.get("empresa_id")?.toString() ?? "",
    regional_id: formData.get("regional_id")?.toString() ?? "",
    tipo_contratacao: formData.get("tipo_contratacao")?.toString() ?? "",
    nivel_id: formData.get("nivel_id")?.toString() ?? "",
    area: formData.get("area")?.toString() ?? "",
    pj_natureza: formData.get("pj_natureza")?.toString() || undefined,
    lider_id: formData.get("lider_id")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("contratacoes")
    .insert({
      tenant_id: session.activeTenant.id,
      created_by: session.profile.id,
      nome: parsed.data.nome,
      email: parsed.data.email,
      cargo: parsed.data.cargo,
      salario_proposto: parsed.data.salario_proposto,
      data_admissao: parsed.data.data_admissao,
      empresa_id: parsed.data.empresa_id,
      regional_id: parsed.data.regional_id,
      tipo_contratacao: parsed.data.tipo_contratacao,
      nivel_id: parsed.data.nivel_id,
      area: parsed.data.area,
      pj_natureza: parsed.data.pj_natureza,
      lider_id: parsed.data.lider_id,
      status: "rascunho",
      token: gerarToken(),
      token_expira_em: prazoLink(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("[rh.contratacao.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "contratacao.criada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "contratacao",
    entidadeId: data.id,
    metadata: {
      nome: parsed.data.nome,
      cargo: parsed.data.cargo,
      salario_proposto: parsed.data.salario_proposto,
      tipo_contratacao: parsed.data.tipo_contratacao,
    },
  });

  revalidatePath("/rh");
  revalidatePath("/rh/contratacoes");
  return { ok: true, id: data.id };
}

/**
 * Envia a proposta ao candidato. Na v1 isso significa apenas mudar o
 * status e gravar timestamp — o RH copia o link `/proposta/[token]` e
 * manda por fora. Envio automático via Resend/SMTP fica pra task 008.
 */
export async function enviarProposta(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.contratacoes.editar");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("contratacoes")
    .update({
      status: "proposta_enviada",
      proposta_enviada_em: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "rascunho")
    .select("id, token")
    .single();

  if (error || !data) {
    console.error("[rh.contratacao.enviar]", error?.message);
    return {
      ok: false,
      message:
        "Não foi possível enviar. A contratação precisa estar em rascunho.",
    };
  }

  await logAuditEvent({
    acao: "contratacao.proposta_enviada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "contratacao",
    entidadeId: id,
  });

  revalidatePath("/rh/contratacoes");
  revalidatePath(`/rh/contratacoes/${id}`);
  return { ok: true, id };
}

/**
 * Gera novo token e estende a expiração por mais 14 dias. Só faz sentido
 * enquanto a contratação está em `proposta_enviada` ou `aceite_recebido`
 * — depois disso o link não é mais o gargalo.
 */
export async function renovarLink(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.contratacoes.editar");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const { error } = await supabase
    .from("contratacoes")
    .update({
      token: gerarToken(),
      token_expira_em: prazoLink(),
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .in("status", ["proposta_enviada", "aceite_recebido", "expirada"]);

  if (error) {
    console.error("[rh.contratacao.renovar_link]", error.message);
    return { ok: false, message: "Não foi possível renovar o link." };
  }

  await logAuditEvent({
    acao: "contratacao.link_renovado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "contratacao",
    entidadeId: id,
  });

  revalidatePath(`/rh/contratacoes/${id}`);
  return { ok: true, id };
}

/**
 * Gera o PDF do contrato PJ a partir do template e sobe pro bucket.
 * Só habilitada quando `tipo_contratacao` é PJ (pj ou clt_recibo) e
 * `pj_natureza` está preenchido. Para CLT/estágio a contabilidade
 * envia o contrato externamente, então essa etapa é pulada.
 *
 * O gerador real de PDF é a Subtask 6 desta task. Enquanto ela não
 * está pronta, esta action retorna erro amigável explicando.
 */
export async function gerarContrato(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.contratacoes.editar");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const { data: contratacao, error: fetchError } = await supabase
    .from("contratacoes")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (fetchError || !contratacao) {
    return { ok: false, message: "Contratação não encontrada." };
  }
  const c = contratacao as unknown as Contratacao;
  if (c.status !== "dados_completos") {
    return {
      ok: false,
      message:
        "Só é possível gerar contrato depois que o candidato preencher os dados.",
    };
  }
  if (
    !TIPOS_PJ_QUE_GERAM_CONTRATO.includes(c.tipo_contratacao) ||
    !c.pj_natureza
  ) {
    return {
      ok: false,
      message:
        "Contrato só é gerado pelo sistema pra PJ. Para CLT/estágio, anexe o contrato enviado pela contabilidade.",
    };
  }

  let pdfBuffer: Buffer;
  try {
    // Dynamic import: mantém o pdfkit fora do cold start das outras
    // actions (anexar/efetivar). Caso contrário, um Unhandled Rejection
    // do pdfkit (fontes não traceadas) derrubava qualquer POST na rota.
    const { gerarContratoPJ } = await import("@/lib/rh/gerar-contrato-pj");
    pdfBuffer = await gerarContratoPJ(c);
  } catch (e: any) {
    console.error("[rh.contratacao.gerar]", e?.message);
    return {
      ok: false,
      message: e?.message ?? "Falha ao gerar o PDF do contrato.",
    };
  }

  const path = `${session.activeTenant.id}/${id}/contrato-gerado.pdf`;
  const { error: upErr } = await supabase.storage
    .from("contratacoes-anexos")
    .upload(path, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upErr) {
    console.error("[rh.contratacao.gerar.upload]", upErr.message);
    return { ok: false, message: "Falha ao subir o PDF gerado." };
  }

  const { error: updErr } = await supabase
    .from("contratacoes")
    .update({
      status: "contrato_gerado",
      contrato_gerado_path: path,
      contrato_gerado_em: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);
  if (updErr) {
    return { ok: false, message: mapDbError(updErr.message) };
  }

  await logAuditEvent({
    acao: "contratacao.contrato_gerado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "contratacao",
    entidadeId: id,
    metadata: {
      pj_natureza: c.pj_natureza,
      tamanho_bytes: pdfBuffer.length,
    },
  });

  revalidatePath(`/rh/contratacoes/${id}`);
  return { ok: true, id };
}

/**
 * Finaliza o anexo do contrato assinado depois que o cliente já subiu
 * o PDF direto pro Supabase Storage via signed URL (veja o route
 * `/api/rh/contratacoes/[id]/upload-url`). Aqui só valida sessão/status
 * e grava o path no DB — nenhum byte do PDF passa pela Function.
 *
 * O padrão anterior (`anexarContratoAssinado` recebendo FormData) fazia
 * o PDF trafegar duas vezes (browser -> Vercel -> Supabase) e empurrava
 * o tempo percebido pra ~7s em contratos de alguns MB.
 */
export async function finalizarAnexoContrato(
  id: string,
  path: string,
  tamanhoBytes: number,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.contratacoes.editar");
  if (!gate.ok) return gate;

  // Path canônico é `${tenant}/${id}/contrato-assinado.pdf`. Se o cliente
  // mandar outro, rejeita — o token da signed URL foi emitido pra esse
  // path exato, então o próprio Storage já teria recusado, mas checar
  // aqui evita gravar um path bagunçado no DB.
  const pathEsperado = `${session.activeTenant.id}/${id}/contrato-assinado.pdf`;
  if (path !== pathEsperado) {
    return { ok: false, message: "Caminho do arquivo inválido." };
  }

  const supabase = createClient();
  const { data: atualizada, error: updErr } = await supabase
    .from("contratacoes")
    .update({
      status: "contrato_assinado",
      contrato_assinado_path: path,
      contrato_assinado_anexado_em: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .in("status", ["dados_completos", "contrato_gerado"])
    .select("id")
    .maybeSingle();
  if (updErr) {
    return { ok: false, message: mapDbError(updErr.message) };
  }
  if (!atualizada) {
    return {
      ok: false,
      message:
        "O upload do contrato assinado só é aceito depois que os dados estão completos.",
    };
  }

  await logAuditEvent({
    acao: "contratacao.contrato_anexado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "contratacao",
    entidadeId: id,
    metadata: { tamanho_bytes: tamanhoBytes },
  });

  revalidatePath(`/rh/contratacoes/${id}`);
  return { ok: true, id };
}

/**
 * Efetiva a contratação: cria colaborador + alocação vigente +
 * salário vigente copiando todos os dados. Preenche
 * `virou_colaborador_id` na contratação, muda status pra `efetivada`.
 *
 * Só permite quando status é `contrato_assinado`.
 */
export async function efetivar(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.contratacoes.efetivar");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const service = createServiceClient();
  const tenantId = session.activeTenant.id;

  const { data: c, error: fetchError } = await supabase
    .from("contratacoes")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (fetchError || !c) {
    return { ok: false, message: "Contratação não encontrada." };
  }
  if (c.status !== "contrato_assinado") {
    return {
      ok: false,
      message:
        "Só é possível efetivar depois que o contrato assinado for anexado.",
    };
  }

  // Validações críticas antes de criar colaborador
  if (!c.cpf) {
    return { ok: false, message: "CPF do candidato está vazio." };
  }
  if (!c.regional_id) {
    return { ok: false, message: "Regional da contratação não definida." };
  }

  // 1. INSERT colaborador
  const { data: colab, error: colErr } = await supabase
    .from("colaboradores")
    .insert({
      tenant_id: tenantId,
      nome: c.nome,
      email: c.email,
      telefone: c.telefone,
      tipo_contratacao: c.tipo_contratacao,
      cpf: c.cpf,
      cnpj: c.cnpj,
      razao_social: c.razao_social,
      pj_natureza: c.pj_natureza,
      rg: c.rg,
      funcao: c.cargo,
      nivel_id: c.nivel_id,
      lider_id: c.lider_id,
      data_nascimento: c.data_nascimento,
      area: c.area,
      data_admissao: c.data_admissao,
      status: "ativo",
      cep: c.cep,
      logradouro: c.logradouro,
      numero: c.numero,
      complemento: c.complemento,
      bairro: c.bairro,
      cidade: c.cidade,
      uf: c.uf,
      banco_codigo: c.banco_codigo,
      banco_nome: c.banco_nome,
      agencia: c.agencia,
      agencia_dv: c.agencia_dv,
      conta: c.conta,
      conta_dv: c.conta_dv,
      tipo_conta: c.tipo_conta,
      pix_tipo: c.pix_tipo,
      pix_chave: c.pix_chave,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (colErr) {
    console.error("[rh.contratacao.efetivar.colab]", colErr.message);
    return {
      ok: false,
      message: "Não foi possível criar o colaborador. " + colErr.message,
    };
  }
  const colaboradorId = colab.id;

  // 2. Alocação vigente
  const { error: alocErr } = await supabase
    .from("colaboradores_alocacoes")
    .insert({
      tenant_id: tenantId,
      colaborador_id: colaboradorId,
      empresa_id: c.empresa_id,
      regional_id: c.regional_id,
      usa_rateio_empresa: false,
      data_inicio: c.data_admissao,
      created_by: session.profile.id,
    });
  if (alocErr) {
    console.error("[rh.contratacao.efetivar.aloc]", alocErr.message);
    await service.from("colaboradores").delete().eq("id", colaboradorId);
    return { ok: false, message: "Falha ao criar a alocação inicial." };
  }

  // 3. Salário vigente
  const { error: salErr } = await supabase
    .from("colaboradores_salarios")
    .insert({
      tenant_id: tenantId,
      colaborador_id: colaboradorId,
      valor: c.salario_proposto,
      data_inicio: c.data_admissao,
      motivo: "Cadastro inicial (contratação efetivada)",
      created_by: session.profile.id,
    });
  if (salErr) {
    console.error("[rh.contratacao.efetivar.sal]", salErr.message);
    await service.from("colaboradores").delete().eq("id", colaboradorId);
    return { ok: false, message: "Falha ao criar o salário inicial." };
  }

  // 4. Fecha a contratação
  const { error: updErr } = await supabase
    .from("contratacoes")
    .update({
      status: "efetivada",
      efetivada_em: new Date().toISOString(),
      virou_colaborador_id: colaboradorId,
    })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (updErr) {
    console.error("[rh.contratacao.efetivar.close]", updErr.message);
    // Não faz rollback aqui — o colaborador já existe e é o desejado;
    // o RH pode marcar manualmente depois se precisar.
    return {
      ok: false,
      message:
        "Colaborador criado, mas houve erro ao fechar a contratação. Verifique manualmente.",
    };
  }

  await logAuditEvent({
    acao: "contratacao.efetivada",
    tenantId,
    entidadeTipo: "contratacao",
    entidadeId: id,
    metadata: { colaborador_id: colaboradorId, nome: c.nome, cargo: c.cargo },
  });

  revalidatePath("/rh");
  revalidatePath("/rh/contratacoes");
  revalidatePath("/rh/colaboradores");
  revalidatePath(`/rh/contratacoes/${id}`);
  return { ok: true, id: colaboradorId };
}

/**
 * Marca uma contratação como `desistiu` (aceitou mas não assinou).
 * Motivo curto obrigatório.
 */
export async function marcarDesistiu(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.contratacoes.editar");
  if (!gate.ok) return gate;

  const parsed = motivoTextoSchema.safeParse({
    motivo: formData.get("motivo")?.toString() ?? "",
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
    .from("contratacoes")
    .update({
      status: "desistiu",
      motivo_desistencia: parsed.data.motivo,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .in("status", [
      "aceite_recebido",
      "dados_completos",
      "contrato_gerado",
      "contrato_assinado",
    ]);
  if (error) {
    console.error("[rh.contratacao.desistiu]", error.message);
    return { ok: false, message: "Não foi possível marcar como desistiu." };
  }

  await logAuditEvent({
    acao: "contratacao.desistiu",
    tenantId: session.activeTenant.id,
    entidadeTipo: "contratacao",
    entidadeId: id,
    metadata: { motivo: parsed.data.motivo },
  });

  revalidatePath("/rh/contratacoes");
  revalidatePath(`/rh/contratacoes/${id}`);
  return { ok: true, id };
}

/**
 * Marca a contratação como `recusada` (candidato disse não antes de
 * assinar — o RH pode marcar direto se, por exemplo, souber a recusa
 * por fora). O caminho normal é o candidato clicar "Recusar" na página
 * pública.
 */
export async function marcarRecusadaPeloRh(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.contratacoes.editar");
  if (!gate.ok) return gate;

  const parsed = motivoTextoSchema.safeParse({
    motivo: formData.get("motivo")?.toString() ?? "",
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
    .from("contratacoes")
    .update({
      status: "recusada",
      motivo_recusa: parsed.data.motivo,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .in("status", ["rascunho", "proposta_enviada"]);
  if (error) {
    console.error("[rh.contratacao.recusada_rh]", error.message);
    return { ok: false, message: "Não foi possível marcar como recusada." };
  }

  await logAuditEvent({
    acao: "contratacao.recusada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "contratacao",
    entidadeId: id,
    metadata: { motivo: parsed.data.motivo, marcada_pelo_rh: true },
  });

  revalidatePath("/rh/contratacoes");
  revalidatePath(`/rh/contratacoes/${id}`);
  return { ok: true, id };
}
