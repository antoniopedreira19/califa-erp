"use server";

/**
 * Abre o documento fiscal de um lançamento do extrato.
 *
 * ⚠️ A action recebe o **id do lançamento**, e não bucket + caminho. O
 * caminho e o bucket são re-derivados aqui, no servidor.
 *
 * Parece rodeio e não é: a coluna Documento cobre quatro origens em três
 * buckets diferentes, e a versão óbvia — o cliente manda `{bucket, path}`
 * e o servidor assina — deixaria qualquer pessoa logada pedir uma URL
 * assinada para *qualquer* arquivo de *qualquer* tenant. O id do
 * lançamento já passa pelo filtro de tenant, e o resto sai dele.
 */

import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENTO_TIPOS_FISCAIS, type DocumentoTipo } from "@/lib/types";

type Result =
  | { ok: true; url: string }
  | { ok: false; message: string };

/** Quanto tempo a URL vive. Curto: ela é para abrir agora, numa aba. */
const TTL_SEGUNDOS = 60;

interface AnexoRow {
  arquivo_path: string;
  documento_tipo: DocumentoTipo | null;
}

/** O primeiro anexo tipado como nota ou recibo — a mesma regra da coluna. */
function caminhoFiscal(anexos: AnexoRow[] | undefined): string | null {
  const alvo = (anexos ?? []).find(
    (a) =>
      a.documento_tipo !== null &&
      DOCUMENTO_TIPOS_FISCAIS.includes(a.documento_tipo),
  );
  return alvo?.arquivo_path ?? null;
}

export async function abrirDocumentoDoLancamento(
  lancamentoId: string,
): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: lancamento, error } = await supabase
    .from("lancamentos_financeiros")
    .select(
      `id,
       pedido_compra:pedidos_compra(
         anexos:pedidos_compra_anexos(arquivo_path, documento_tipo)
       ),
       desembolso:desembolsos(
         anexos:desembolsos_anexos(arquivo_path, documento_tipo)
       ),
       conta_avulsa:contas_avulsas!conta_avulsa_id(
         anexos:contas_avulsas_anexos(arquivo_path, documento_tipo)
       ),
       titulo:titulos_receber!lancamentos_financeiros_titulo_receber_id_fkey(
         faturamento:faturamentos(anexo_nf_path)
       )`,
    )
    .eq("id", lancamentoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<any>();

  if (error || !lancamento) {
    return { ok: false, message: "Lançamento não encontrado." };
  }

  // Cada origem mora num bucket próprio. A ordem é a mesma da coluna, para
  // o link abrir exatamente o documento que está escrito nela.
  const candidatos: Array<{ bucket: string; path: string | null }> = [
    {
      bucket: "pedidos-compra",
      path: caminhoFiscal(lancamento.pedido_compra?.anexos),
    },
    {
      bucket: "desembolsos",
      path: caminhoFiscal(lancamento.desembolso?.anexos),
    },
    {
      bucket: "contas-avulsas",
      path: caminhoFiscal(lancamento.conta_avulsa?.anexos),
    },
    {
      bucket: "faturamentos-nf",
      path: lancamento.titulo?.faturamento?.anexo_nf_path ?? null,
    },
  ];

  const alvo = candidatos.find((c) => c.path);
  if (!alvo?.path) {
    return {
      ok: false,
      message: "Este lançamento não tem documento fiscal anexado.",
    };
  }

  const { data, error: urlErr } = await supabase.storage
    .from(alvo.bucket)
    .createSignedUrl(alvo.path, TTL_SEGUNDOS);

  if (urlErr || !data) {
    return { ok: false, message: "Não foi possível abrir o documento." };
  }
  return { ok: true, url: data.signedUrl };
}
