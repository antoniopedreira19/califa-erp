"use server";

/**
 * Prestação de contas da verba pela produção (decisões 081 e 189).
 *
 * Desde a 189 os documentos entram um a um e ficam salvos no banco como
 * rascunho, desde que a PP foi enviada ao financeiro — mesmo antes do
 * pagamento. O envio ao financeiro é um só, no fim, e só com a verba paga.
 *
 * Quem pode — administrador, GP, produtor, o freela do job e o responsável
 * da verba de produção anterior à 171 — e o resto da regra (status da PP,
 * campos de cada tipo, soma dentro da verba) são checados nas funções do
 * banco. As actions validam o formato, chamam a função e cuidam do que a
 * função não alcança: o arquivo no Storage, a auditoria e a revalidação.
 *
 * Salvar um campo NÃO revalida a página do job: a gaveta guarda o estado e
 * a página se atualiza quando ela fecha. Revalidar a cada campo refaria o
 * job inteiro a cada tecla (docs/PERFORMANCE.md).
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  PP_ANEXO_MIMETYPES_ACEITOS,
  PP_ANEXO_TAMANHO_MAX_BYTES,
} from "@/lib/types";
import { TIPOS_DA_PRESTACAO } from "@/lib/calculos/prestacao-da-verba";

const BUCKET = "pedidos-compra";
const ANEXO_TTL_SEGUNDOS = 3600;

type Err = { ok: false; message: string };

/** Os campos que a produção edita em cada documento. */
const camposSchema = z.object({
  documento_tipo: z
    .string()
    .refine((t) => (TIPOS_DA_PRESTACAO as readonly string[]).includes(t), "Tipo de documento inválido.")
    .nullable()
    .default(null),
  documento_numero: z.string().max(60, "O número passa de 60 caracteres.").default(""),
  documento_data: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Data inválida.")
    .default(""),
  valor: z.number().positive("Informe um valor maior que zero.").max(999_999_999).nullable().default(null),
  tomador_estabelecimento_id: z.string().uuid().nullable().default(null),
  emitente_documento: z.string().max(30).default(""),
  emitente_nome: z.string().max(200, "Nome longo demais (até 200 caracteres).").default(""),
  descricao: z.string().max(200, "Descrição longa demais (até 200 caracteres).").default(""),
});

const salvarSchema = z.object({
  pp_id: z.string().uuid(),
  documento: camposSchema.extend({
    /** Documento já salvo. Null = arquivo novo, que acabou de subir. */
    id: z.string().uuid().nullable().default(null),
    path: z.string().max(600).nullable().default(null),
    nome_original: z.string().max(500).nullable().default(null),
    tamanho_bytes: z
      .number()
      .int()
      .positive()
      .max(PP_ANEXO_TAMANHO_MAX_BYTES, "Documento acima de 8 MB.")
      .nullable()
      .default(null),
    mimetype: z
      .string()
      .refine(
        (m) => (PP_ANEXO_MIMETYPES_ACEITOS as readonly string[]).includes(m),
        "Formato de documento não aceito.",
      )
      .nullable()
      .default(null),
  }),
});

/** Onde o navegador sobe os arquivos: a policy do bucket exige o tenant
 *  na primeira pasta. */
export async function prefixoUploadPrestacao(
  pp_id: string,
): Promise<{ ok: true; prefixo: string } | Err> {
  const session = await requireSession();
  const supabase = createClient();
  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("id, verba_producao")
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!pp) return { ok: false, message: "PP não encontrada." };
  if (!pp.verba_producao) {
    return { ok: false, message: "Esta PP não é de verba." };
  }
  return {
    ok: true,
    prefixo: `${session.activeTenant.id}/verba-prestacoes/${pp.id}/`,
  };
}

/**
 * Salva um documento: o arquivo novo (que o navegador acabou de subir) ou
 * os campos de um já salvo. Devolve o id do documento.
 */
export async function salvarDocumentoPrestacao(
  input: z.input<typeof salvarSchema>,
): Promise<{ ok: true; id: string } | Err> {
  const parsed = salvarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { pp_id, documento } = parsed.data;
  const session = await requireSession();
  const supabase = createClient();

  const { data: id, error } = await supabase.rpc("salvar_documento_prestacao_verba", {
    p_pp_id: pp_id,
    p_documento: {
      ...documento,
      documento_numero: documento.documento_numero.trim(),
      valor: documento.valor == null ? null : Math.round(documento.valor * 100) / 100,
    },
  });
  if (error) return { ok: false, message: error.message };

  // Só o arquivo novo vai à auditoria: os campos se salvam a cada pausa da
  // digitação, e o envio registra o conjunto.
  if (!documento.id) {
    await logAuditEvent({
      acao: "verba_producao.prestacao_documento_anexado",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: pp_id,
      metadata: { documento_id: id, nome: documento.nome_original, tamanho_bytes: documento.tamanho_bytes },
    });
  }
  return { ok: true, id: id as string };
}

/** Remove um documento salvo, e o arquivo dele do Storage. */
export async function removerDocumentoPrestacao(input: {
  pp_id: string;
  documento_id: string;
}): Promise<{ ok: true } | Err> {
  const parsed = z
    .object({ pp_id: z.string().uuid(), documento_id: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: "Dados inválidos." };
  const session = await requireSession();
  const supabase = createClient();

  const { data: path, error } = await supabase.rpc("remover_documento_prestacao_verba", {
    p_documento_id: parsed.data.documento_id,
  });
  if (error) return { ok: false, message: error.message };
  if (typeof path === "string" && path) {
    await supabase.storage.from(BUCKET).remove([path]);
  }

  await logAuditEvent({
    acao: "verba_producao.prestacao_documento_removido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parsed.data.pp_id,
    metadata: { documento_id: parsed.data.documento_id },
  });
  return { ok: true };
}

/**
 * O envio único da prestação ao financeiro (só com a verba paga). Com "não
 * houve gasto", os documentos salvos saem — e os arquivos deles do Storage.
 */
export async function enviarPrestacaoVerba(input: {
  pp_id: string;
  sem_gasto: boolean;
}): Promise<{ ok: true; reenvio: boolean; codigo: string } | Err> {
  const parsed = z
    .object({ pp_id: z.string().uuid(), sem_gasto: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: "Dados inválidos." };
  const { pp_id, sem_gasto } = parsed.data;
  const session = await requireSession();
  const supabase = createClient();

  const [{ data: pp }, { data: antes }] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select("id, codigo, job_id, valor")
      .eq("id", pp_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("pp_verba_prestacoes")
      .select("id, status, documentos:pp_verba_prestacoes_anexos(id, arquivo_path)")
      .eq("pedido_compra_id", pp_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
  ]);
  if (!pp) return { ok: false, message: "PP não encontrada." };

  const { error } = await supabase.rpc("enviar_prestacao_verba_salva", {
    p_pp_id: pp_id,
    p_sem_gasto: sem_gasto,
  });
  if (error) return { ok: false, message: error.message };

  const docsAntes =
    (antes as { documentos?: Array<{ id: string; arquivo_path: string }> } | null)?.documentos ?? [];
  if (sem_gasto && docsAntes.length > 0) {
    await supabase.storage.from(BUCKET).remove(docsAntes.map((d) => d.arquivo_path));
  }

  const { data: depois } = await supabase
    .from("pp_verba_prestacoes")
    .select("valor_gasto, valor_devolvido")
    .eq("pedido_compra_id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  const reenvio = (antes as { status?: string } | null)?.status === "reprovada";

  await logAuditEvent({
    acao: "verba_producao.prestacao_enviada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      reenvio,
      sem_gasto,
      documentos: sem_gasto ? 0 : docsAntes.length,
      valor_gasto: Number(depois?.valor_gasto ?? 0),
      saldo: Number(depois?.valor_devolvido ?? 0),
    },
  });

  revalidatePath(`/jobs/${pp.job_id}`);
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, reenvio, codigo: pp.codigo };
}

/** Abre um documento da prestação (link assinado de 1 h). */
export async function linkDocumentoPrestacao(
  documento_id: string,
): Promise<{ ok: true; url: string } | Err> {
  const session = await requireSession();
  const supabase = createClient();
  const { data: doc } = await supabase
    .from("pp_verba_prestacoes_anexos")
    .select("arquivo_path")
    .eq("id", documento_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!doc) return { ok: false, message: "Documento não encontrado." };
  const { data: assinado, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.arquivo_path, ANEXO_TTL_SEGUNDOS);
  if (error || !assinado) {
    return { ok: false, message: "Não foi possível abrir o documento." };
  }
  return { ok: true, url: assinado.signedUrl };
}
