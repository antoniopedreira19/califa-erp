"use server";

/**
 * Server actions do wizard de boas-vindas (perfil complementar do
 * colaborador). As 3 mutações passam pelas RPCs SECURITY DEFINER
 * criadas na 20261116700001 — o colaborador comum não tem UPDATE
 * direto em `colaboradores`.
 *
 * Decisão combinada no brainstorm de 16/11/2026:
 *  - O modal aparece pra quem tem user_id em colaboradores, status
 *    ativo e tipo_contratacao != 'socio'. Enquanto
 *    perfil_completado_em IS NULL, reaparece em toda sessão nova.
 *  - Upload é client-side direto pro bucket colaboradores-documentos
 *    (RLS do bucket garante que ele só escreve na própria pasta).
 *    Depois do upload, a UI chama `registrarDocumentoDoMeuPerfil`
 *    pra criar o metadado + audit.
 *  - "Completar" valida tudo e grava perfil_completado_em = now().
 *    Daí em diante o modal nunca mais aparece — mesmo que a gente
 *    adicione um campo novo depois.
 */

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import {
  perfilRascunhoSchema,
  type PerfilRascunho,
} from "@/lib/perfil/schema";
import { normalizarChavePix, type PixTipo } from "@/lib/perfil/pix";
import type {
  Colaborador,
  ColaboradorDocumento,
  ColaboradorDocumentoTipo,
} from "@/lib/types";

type ActionResult<T = { id: string }> =
  | ({ ok: true } & T)
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[]>;
      camposPendentes?: string[];
      documentosPendentes?: ColaboradorDocumentoTipo[];
    };

// ---------- Leitura: perfil completo do usuário logado ----------------

export interface MeuPerfilPayload {
  colaborador: Colaborador;
  documentos: ColaboradorDocumento[];
}

/**
 * Lê o colaborador vinculado ao user logado e seus documentos.
 * Retorna null se o user não tem vínculo em colaboradores (ex: admin
 * puro, freelancer). Nunca lança — o chamador decide o que fazer.
 */
export async function lerMeuPerfilCompleto(): Promise<MeuPerfilPayload | null> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: colab } = await supabase
    .from("colaboradores")
    .select("*")
    .eq("user_id", session.profile.id)
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "ativo")
    .maybeSingle();

  if (!colab) return null;

  const { data: docs } = await supabase
    .from("colaboradores_documentos")
    .select("*")
    .eq("colaborador_id", (colab as Colaborador).id)
    .order("uploaded_at", { ascending: false });

  return {
    colaborador: colab as Colaborador,
    documentos: (docs ?? []) as ColaboradorDocumento[],
  };
}

// ---------- Mutação: salvar rascunho (passo do wizard) ----------------

export async function salvarRascunhoDoMeuPerfil(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();

  const parsed = perfilRascunhoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const dados = removerUndefineds(parsed.data);

  // O CHECK colaboradores_pix_formato exige E.164 pra telefone e só dígitos
  // pra CPF/CNPJ. O usuário digita com máscara — normaliza aqui pra não
  // esbarrar no constraint. Só mexe quando a chave veio no payload.
  if ("pix_chave" in dados) {
    const tipo = (dados.pix_tipo ?? null) as PixTipo | null;
    dados.pix_chave = normalizarChavePix(tipo, dados.pix_chave as string | null);
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("atualizar_meu_perfil_colaborador", {
    p_dados: dados,
  });

  if (error) {
    console.error("[boas-vindas.rascunho]", error.message);
    return {
      ok: false,
      message:
        error.message === "usuario_sem_colaborador"
          ? "Seu login não está vinculado a um colaborador. Fale com o RH."
          : "Não foi possível salvar: " + error.message,
    };
  }

  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id, tenant_id")
    .eq("user_id", session.profile.id)
    .maybeSingle();

  if (colab) {
    await logAuditEvent({
      acao: "perfil.rascunho_salvo",
      tenantId: colab.tenant_id,
      entidadeTipo: "colaborador",
      entidadeId: colab.id,
      metadata: {
        campos_alterados: Object.keys(dados),
      },
    });
  }

  revalidatePath("/perfil");
  return { ok: true, id: colab?.id ?? "" };
}

// ---------- Mutação: completar perfil (último passo) -------------------

export async function completarMeuPerfil(): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { error } = await supabase.rpc("completar_meu_perfil_colaborador");

  if (error) {
    // A RPC levanta "perfil_incompleto: campos=X,Y documentos=A,B"
    // quando falta coisa. Parseia para a UI destacar o que falta.
    const match = /perfil_incompleto: campos=([^ ]*) documentos=(.*)/.exec(
      error.message,
    );
    if (match) {
      const camposStr = match[1] ?? "";
      const docsStr = match[2] ?? "";
      return {
        ok: false,
        message: "Ainda faltam informações pra completar seu perfil.",
        camposPendentes: camposStr ? camposStr.split(",") : [],
        documentosPendentes: docsStr
          ? (docsStr.split(",") as ColaboradorDocumentoTipo[])
          : [],
      };
    }
    console.error("[boas-vindas.completar]", error.message);
    return {
      ok: false,
      message:
        error.message === "usuario_sem_colaborador"
          ? "Seu login não está vinculado a um colaborador."
          : "Não foi possível completar: " + error.message,
    };
  }

  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id, tenant_id")
    .eq("user_id", session.profile.id)
    .maybeSingle();

  if (colab) {
    await logAuditEvent({
      acao: "perfil.completado",
      tenantId: colab.tenant_id,
      entidadeTipo: "colaborador",
      entidadeId: colab.id,
    });
  }

  revalidatePath("/perfil");
  revalidatePath("/");
  return { ok: true, id: colab?.id ?? "" };
}

// ---------- Mutação: registrar documento após upload -------------------

/**
 * Chamada DEPOIS do upload do arquivo pro bucket pelo cliente. Insere
 * a linha de metadado em `colaboradores_documentos`. A RLS da tabela
 * só deixa o próprio colaborador escrever na própria pasta.
 */
export async function registrarDocumentoDoMeuPerfil(input: {
  tipo: ColaboradorDocumentoTipo;
  arquivo_path: string;
  arquivo_nome: string;
  arquivo_tamanho_bytes: number;
  mime_type: string;
}): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id, tenant_id")
    .eq("user_id", session.profile.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!colab) {
    return {
      ok: false,
      message: "Seu login não está vinculado a um colaborador.",
    };
  }

  // Garante que o path começa pelo tenant + colaborador corretos.
  const prefixoEsperado = `${colab.tenant_id}/${colab.id}/`;
  if (!input.arquivo_path.startsWith(prefixoEsperado)) {
    return {
      ok: false,
      message: "Caminho do arquivo inválido.",
    };
  }

  const { data: doc, error } = await supabase
    .from("colaboradores_documentos")
    .insert({
      tenant_id: colab.tenant_id,
      colaborador_id: colab.id,
      tipo: input.tipo,
      arquivo_path: input.arquivo_path,
      arquivo_nome: input.arquivo_nome,
      arquivo_tamanho_bytes: input.arquivo_tamanho_bytes,
      mime_type: input.mime_type,
      uploaded_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error || !doc) {
    console.error("[boas-vindas.registrar-doc]", error?.message);
    // Tenta limpar o arquivo pra não ficar órfão.
    await supabase.storage
      .from("colaboradores-documentos")
      .remove([input.arquivo_path]);
    return {
      ok: false,
      message: "Não foi possível registrar o arquivo: " + (error?.message ?? ""),
    };
  }

  await logAuditEvent({
    acao: "perfil.documento_anexado",
    tenantId: colab.tenant_id,
    entidadeTipo: "colaborador_documento",
    entidadeId: doc.id,
    metadata: {
      colaborador_id: colab.id,
      tipo: input.tipo,
      nome: input.arquivo_nome,
      tamanho_bytes: input.arquivo_tamanho_bytes,
    },
  });

  revalidatePath("/perfil");
  return { ok: true, id: doc.id };
}

// ---------- Mutação: remover documento ---------------------------------

export async function removerDocumentoDoMeuPerfil(
  documentoId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: doc } = await supabase
    .from("colaboradores_documentos")
    .select("id, tenant_id, colaborador_id, arquivo_path, tipo")
    .eq("id", documentoId)
    .maybeSingle();

  if (!doc) {
    return { ok: false, message: "Documento não encontrado." };
  }

  // Só o dono (via RLS já filtra, mas confirma o colaborador).
  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id")
    .eq("user_id", session.profile.id)
    .eq("tenant_id", (doc as ColaboradorDocumento).tenant_id)
    .maybeSingle();

  if (!colab || colab.id !== (doc as ColaboradorDocumento).colaborador_id) {
    return {
      ok: false,
      message: "Você não pode remover este documento.",
    };
  }

  // Apaga arquivo primeiro; mesmo que falhe, remove a linha pra não
  // ficar visível.
  await supabase.storage
    .from("colaboradores-documentos")
    .remove([(doc as ColaboradorDocumento).arquivo_path]);

  const { error: delErr } = await supabase
    .from("colaboradores_documentos")
    .delete()
    .eq("id", documentoId);

  if (delErr) {
    console.error("[boas-vindas.remover-doc]", delErr.message);
    return {
      ok: false,
      message: "Não foi possível remover: " + delErr.message,
    };
  }

  await logAuditEvent({
    acao: "perfil.documento_removido",
    tenantId: (doc as ColaboradorDocumento).tenant_id,
    entidadeTipo: "colaborador_documento",
    entidadeId: documentoId,
    metadata: {
      colaborador_id: colab.id,
      tipo: (doc as ColaboradorDocumento).tipo,
    },
  });

  revalidatePath("/perfil");
  return { ok: true, id: documentoId };
}

// ---------- helpers ----------------------------------------------------

/**
 * Remove undefineds do JSON (mantém nulls). A RPC usa jsonb ? 'chave'
 * pra distinguir "mantém" (chave ausente) de "limpa" (chave=null).
 * Zod `.optional()` deixa undefined; tiramos antes de mandar.
 */
function removerUndefineds(obj: PerfilRascunho): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
