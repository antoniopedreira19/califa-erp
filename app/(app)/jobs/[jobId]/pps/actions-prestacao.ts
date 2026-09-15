"use server";

/**
 * Prestação de contas da verba pela produção (decisão 081).
 *
 * Quem pode — o responsável pela verba, o responsável do job ou um
 * administrador — é checado dentro de `enviar_prestacao_verba`, junto de
 * tudo que importa: verba paga, documentos NF/recibo com valor, soma dentro
 * da verba. A action valida o formato, chama a função e cuida do que a
 * função não alcança: apagar do Storage o arquivo do documento que saiu na
 * correção, a auditoria e a revalidação das telas.
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

const BUCKET = "pedidos-compra";
const ANEXO_TTL_SEGUNDOS = 3600;

type Err = { ok: false; message: string };

const documentoSchema = z.object({
  /** Documento já gravado que continua (correção). Null = arquivo novo. */
  id: z.string().uuid().nullable().default(null),
  path: z.string().max(600).nullable().default(null),
  nome_original: z.string().max(500).nullable().default(null),
  tamanho_bytes: z
    .number()
    .int()
    .nonnegative()
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
  documento_tipo: z
    .string()
    .refine(
      (t) => t === "nota_fiscal" || t === "recibo",
      "Só NF e recibo comprovam gasto da verba.",
    ),
  documento_numero: z.string().trim().max(60).nullable().default(null),
  valor: z
    .number({ invalid_type_error: "Informe o valor de cada documento." })
    .positive("Informe o valor de cada documento.")
    .max(999_999_999, "Valor fora do esperado."),
});

const envioSchema = z
  .object({
    pp_id: z.string().uuid(),
    /** "Não houve gasto": a prestação vai sem documento e a verba volta
     *  inteira. Explícito — lista vazia sem marcar continua recusada. */
    sem_gasto: z.boolean().default(false),
    documentos: z.array(documentoSchema).max(60, "Documentos demais numa prestação só."),
  })
  .superRefine((v, ctx) => {
    if (!v.sem_gasto && v.documentos.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Anexe ao menos um documento — NF ou recibo.",
        path: ["documentos"],
      });
    }
    if (v.sem_gasto && v.documentos.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sem gasto, a prestação vai sem documento.",
        path: ["documentos"],
      });
    }
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
    return { ok: false, message: "Esta PP não é de verba de produção." };
  }
  return {
    ok: true,
    prefixo: `${session.activeTenant.id}/verba-prestacoes/${pp.id}/`,
  };
}

export async function enviarPrestacaoVerba(
  input: z.input<typeof envioSchema>,
): Promise<{ ok: true; reenvio: boolean; codigo: string } | Err> {
  const parsed = envioSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }
  const { pp_id, documentos, sem_gasto } = parsed.data;
  const session = await requireSession();
  const supabase = createClient();

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("id, codigo, job_id, valor")
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!pp) return { ok: false, message: "PP não encontrada." };

  // O que já estava gravado: o arquivo do documento que sair do conjunto
  // é apagado do Storage depois que a função aceitar o envio.
  const { data: antes } = await supabase
    .from("pp_verba_prestacoes")
    .select("id, documentos:pp_verba_prestacoes_anexos(id, arquivo_path)")
    .eq("pedido_compra_id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  const { error } = await supabase.rpc("enviar_prestacao_verba", {
    p_pp_id: pp_id,
    p_sem_gasto: sem_gasto,
    p_documentos: documentos.map((d) => ({
      id: d.id,
      path: d.path,
      nome_original: d.nome_original,
      tamanho_bytes: d.tamanho_bytes,
      mimetype: d.mimetype,
      documento_tipo: d.documento_tipo,
      documento_numero: d.documento_numero,
      valor: Math.round(d.valor * 100) / 100,
    })),
  });
  if (error) return { ok: false, message: error.message };

  const mantidos = new Set(documentos.map((d) => d.id).filter(Boolean));
  const removidos = (
    ((antes as { documentos?: Array<{ id: string; arquivo_path: string }> } | null)
      ?.documentos ?? [])
  )
    .filter((d) => !mantidos.has(d.id))
    .map((d) => d.arquivo_path);
  if (removidos.length > 0) {
    await supabase.storage.from(BUCKET).remove(removidos);
  }

  const gastoCentavos = documentos.reduce(
    (s, d) => s + Math.round(d.valor * 100),
    0,
  );
  await logAuditEvent({
    acao: "verba_producao.prestacao_enviada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      reenvio: antes != null,
      sem_gasto,
      documentos: documentos.length,
      valor_gasto: gastoCentavos / 100,
      saldo: Math.round(Number(pp.valor) * 100 - gastoCentavos) / 100,
    },
  });

  revalidatePath(`/jobs/${pp.job_id}`);
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, reenvio: antes != null, codigo: pp.codigo };
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
