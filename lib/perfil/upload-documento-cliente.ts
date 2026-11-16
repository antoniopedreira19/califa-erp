"use client";

/**
 * Helper client-side pra enviar um documento do perfil pro bucket
 * `colaboradores-documentos` e registrar o metadado via server action.
 *
 * O upload acontece direto no browser (RLS do bucket garante que a
 * pessoa só escreve na própria pasta). Depois chamamos a server action
 * `registrarDocumentoDoMeuPerfil` pra inserir a linha + audit.
 *
 * Path do arquivo: {tenant_id}/{colaborador_id}/{tipo}/{uuid}-{nome}
 *   O prefixo tenant/colaborador é o que a RLS do bucket espera. O
 *   UUID evita colisão quando a pessoa sobe dois com o mesmo nome.
 */

import { createClient } from "@/lib/supabase/client";
import { registrarDocumentoDoMeuPerfil } from "@/app/(app)/_boas-vindas/actions";
import type { ColaboradorDocumentoTipo } from "@/lib/types";
import {
  MIME_TYPES_ACEITOS,
  TAMANHO_MAX_BYTES,
} from "./documentos-obrigatorios";

const BUCKET = "colaboradores-documentos";

export interface UploadResult {
  ok: boolean;
  id?: string;
  path?: string;
  message?: string;
}

export async function uploadDocumentoDoMeuPerfil(params: {
  tenant_id: string;
  colaborador_id: string;
  tipo: ColaboradorDocumentoTipo;
  arquivo: File;
}): Promise<UploadResult> {
  const { tenant_id, colaborador_id, tipo, arquivo } = params;

  // Validações locais antes de gastar upload.
  if (arquivo.size > TAMANHO_MAX_BYTES) {
    return {
      ok: false,
      message: `Arquivo muito grande (máx ${Math.round(TAMANHO_MAX_BYTES / 1024 / 1024)} MB).`,
    };
  }
  const mime = arquivo.type || inferirMime(arquivo.name);
  if (!MIME_TYPES_ACEITOS.includes(mime)) {
    return {
      ok: false,
      message: "Formato não aceito. Use PDF, JPG, PNG ou HEIC.",
    };
  }

  const supabase = createClient();
  const nomeSeguro = sanitizarNomeArquivo(arquivo.name);
  const path = `${tenant_id}/${colaborador_id}/${tipo}/${crypto.randomUUID()}-${nomeSeguro}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, arquivo, {
      contentType: mime,
      upsert: false,
    });

  if (upErr) {
    return {
      ok: false,
      message: "Falha no upload: " + upErr.message,
    };
  }

  const result = await registrarDocumentoDoMeuPerfil({
    tipo,
    arquivo_path: path,
    arquivo_nome: arquivo.name,
    arquivo_tamanho_bytes: arquivo.size,
    mime_type: mime,
  });

  if (!result.ok) {
    // Server action falhou — ela já tenta remover o arquivo, mas
    // garantimos aqui também.
    await supabase.storage.from(BUCKET).remove([path]);
    return { ok: false, message: result.message };
  }

  return { ok: true, id: result.id, path };
}

/** URL assinada temporária pro cliente visualizar/baixar o próprio
 *  documento. Vale por 1 minuto. */
export async function urlAssinadaDoDocumento(
  path: string,
): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60);
  if (error) return null;
  return data.signedUrl;
}

// ---------- helpers ----------------------------------------------------

function sanitizarNomeArquivo(nome: string): string {
  // Tira acentos, troca espaço/caractere especial por _ e corta em 80.
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9.\-_]+/g, "_")
    .slice(0, 80);
}

function inferirMime(nome: string): string {
  const ext = nome.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  return "application/octet-stream";
}
