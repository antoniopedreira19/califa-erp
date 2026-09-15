import type { DevolucaoDaVerba, PrestacaoDaVerba } from "@/lib/types";

/**
 * A prestação de contas da verba embutida na consulta de `pedidos_compra`
 * (decisão 081). Um trecho só, para a aba de PPs do job, o financeiro e o
 * chat lerem os mesmos campos.
 *
 * As duas dicas de FK não são enfeite: `pp_verba_devolucoes` aponta para a
 * PP e para a prestação, e sem a dica o PostgREST enxerga um segundo
 * caminho entre PP e prestação e recusa o embed — a tela ficaria vazia em
 * silêncio. E a prestação tem três FKs para `profiles`, então cada nome
 * também leva a coluna.
 */
export const SELECT_PRESTACAO_DA_VERBA =
  "prestacao:pp_verba_prestacoes!pp_verba_prestacoes_pedido_compra_id_fkey(" +
  "id, status, valor_gasto, valor_devolvido, fechada_em, motivo_reprovacao, reprovada_em, aprovada_em, " +
  "enviada_por:profiles!fechada_por(nome), reprovada_por:profiles!reprovada_por(nome), aprovada_por:profiles!aprovada_por(nome), " +
  "documentos:pp_verba_prestacoes_anexos(id, arquivo_nome_original, arquivo_tamanho_bytes, arquivo_mimetype, documento_tipo, documento_numero, valor, created_at)" +
  "), " +
  "devolucao:pp_verba_devolucoes!pp_verba_devolucoes_pedido_compra_id_fkey(id, valor, data_pagamento, pago_em)";

/** Embed de FK única chega como objeto; o resto, como lista. Aceita os dois. */
function primeiro<T>(bruto: T | T[] | null | undefined): T | null {
  if (Array.isArray(bruto)) return bruto[0] ?? null;
  return bruto ?? null;
}

export function prestacaoDaVerba(bruto: any): PrestacaoDaVerba | null {
  const p = primeiro(bruto);
  if (!p) return null;
  return {
    id: p.id,
    status: p.status,
    valor_gasto: Number(p.valor_gasto ?? 0),
    valor_devolvido: Number(p.valor_devolvido ?? 0),
    enviada_em: p.fechada_em,
    enviada_por_nome: primeiro(p.enviada_por)?.nome ?? null,
    motivo_reprovacao: p.motivo_reprovacao ?? null,
    reprovada_em: p.reprovada_em ?? null,
    reprovada_por_nome: primeiro(p.reprovada_por)?.nome ?? null,
    aprovada_em: p.aprovada_em ?? null,
    aprovada_por_nome: primeiro(p.aprovada_por)?.nome ?? null,
    documentos: ((p.documentos ?? []) as any[])
      .slice()
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((d) => ({
        id: d.id,
        arquivo_nome_original: d.arquivo_nome_original,
        arquivo_tamanho_bytes: Number(d.arquivo_tamanho_bytes ?? 0),
        arquivo_mimetype: d.arquivo_mimetype,
        documento_tipo: d.documento_tipo,
        documento_numero: d.documento_numero ?? null,
        valor: Number(d.valor ?? 0),
      })),
  };
}

export function devolucaoDaVerba(bruto: any): DevolucaoDaVerba | null {
  const d = primeiro(bruto);
  if (!d) return null;
  return {
    id: d.id,
    valor: Number(d.valor ?? 0),
    data_pagamento: d.data_pagamento,
    pago_em: d.pago_em ?? null,
  };
}
