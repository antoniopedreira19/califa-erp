"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { DOCUMENTO_TIPOS } from "@/lib/types";

const BUCKET = "pedidos-compra";
const ANEXO_TTL_SEGUNDOS = 3600;

type Ok<T extends object = object> = { ok: true } & T;
type Err = { ok: false; message: string };
type Result<T extends object = object> = Ok<T> | Err;

const anexoSchema = z.object({
  path: z.string().min(1),
  nome_original: z.string().min(1).max(500),
  tamanho_bytes: z.number().int().positive(),
  mimetype: z.string().min(1).max(200),
  // É aqui que as notas da verba de produção entram: a PP de verba sai sem
  // anexo, e o documento só existe depois que o responsável gasta.
  documento_tipo: z.enum(DOCUMENTO_TIPOS).nullable().default(null),
  documento_numero: z.string().trim().max(60).nullable().default(null),
});

const payloadSchema = z.object({
  pp_id: z.string().uuid(),
  valor_gasto: z.number().positive(),
  anexos: z.array(anexoSchema).min(1, "Anexe ao menos uma nota fiscal."),
});

/**
 * Fecha a prestação de contas de uma PP de Verba de Produção.
 *
 * Ordem de operações:
 * 1. Valida payload via Zod.
 * 2. Chama o RPC `fechar_prestacao_verba_pp` — ele valida tenant, verba,
 *    status e valor, e cria a linha em `pp_verba_prestacoes`.
 * 3. Insere os anexos em `pp_verba_prestacoes_anexos`, vinculados ao
 *    `prestacao_id` retornado pelo RPC.
 *
 * Se o insert de anexos falhar após o RPC ter gravado, os arquivos do
 * Storage ficam órfãos — aceitável no MVP (mesma decisão de gerar-pp-drawer).
 */
export async function fecharPrestacaoVerba(
  payload: z.infer<typeof payloadSchema>,
): Promise<Result<{ prestacao_id: string }>> {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.errors[0]?.message ?? "Dados inválidos.",
    };
  }

  const session = await requireSession();
  const supabase = createClient();

  // Chama o RPC. Ele valida tudo (tenant, verba, status, valor).
  const { data: prestacaoId, error: rpcErr } = await supabase.rpc(
    "fechar_prestacao_verba_pp",
    {
      p_pp_id: parsed.data.pp_id,
      p_valor_gasto: parsed.data.valor_gasto,
      p_fechada_por: session.profile.id,
    },
  );

  if (rpcErr || !prestacaoId) {
    return {
      ok: false,
      message: rpcErr?.message ?? "Não foi possível fechar a prestação.",
    };
  }

  // Insere anexos vinculados à prestação. Se falhar aqui, arquivos ficam
  // no Storage órfãos — aceitável no MVP (mesma decisão do gerar-pp).
  const rowsAnexos = parsed.data.anexos.map((a) => ({
    tenant_id: session.activeTenant.id,
    prestacao_id: prestacaoId as string,
    arquivo_path: a.path,
    arquivo_nome_original: a.nome_original,
    arquivo_tamanho_bytes: a.tamanho_bytes,
    arquivo_mimetype: a.mimetype,
    documento_tipo: a.documento_tipo,
    documento_numero: a.documento_tipo ? a.documento_numero : null,
    created_by: session.profile.id,
  }));

  const { error: anexosErr } = await supabase
    .from("pp_verba_prestacoes_anexos")
    .insert(rowsAnexos);

  if (anexosErr) {
    return {
      ok: false,
      message: `Prestação gravada, mas anexos falharam: ${anexosErr.message}`,
    };
  }

  await logAuditEvent({
    acao: "verba_producao.prestacao_fechada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parsed.data.pp_id,
    metadata: {
      prestacao_id: prestacaoId,
      valor_gasto: parsed.data.valor_gasto,
      qtd_anexos: parsed.data.anexos.length,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, prestacao_id: prestacaoId as string };
}

/**
 * Gera uma URL assinada (TTL 1h) para download de um anexo de prestação.
 * Valida tenant antes de assinar — impede acesso cross-tenant.
 */
export async function signedUrlAnexoPrestacao(
  anexo_id: string,
): Promise<Result<{ url: string }>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: anexo, error } = await supabase
    .from("pp_verba_prestacoes_anexos")
    .select("arquivo_path")
    .eq("id", anexo_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (error || !anexo) {
    return { ok: false, message: "Anexo não encontrado." };
  }

  const { data: signed, error: signedErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(anexo.arquivo_path, ANEXO_TTL_SEGUNDOS);

  if (signedErr || !signed) {
    return { ok: false, message: "Não foi possível gerar o link." };
  }

  return { ok: true, url: signed.signedUrl };
}
