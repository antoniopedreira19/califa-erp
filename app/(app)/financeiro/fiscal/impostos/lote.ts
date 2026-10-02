/**
 * O imposto a pagar no formato da baixa em lote e da aba Títulos da
 * conciliação (módulo fiscal, entrega 2): a chave, a referência (o DARF ou a
 * guia municipal), o órgão que recebe e o título no formato do lote. Módulo
 * puro — vale no servidor, no cliente e no teste.
 */

import type { TituloParaLote } from "@/components/financeiro/baixa-em-lote";
import type { ImpostoDaLista } from "./dados";

const ORGAO_FEDERAL = "Receita Federal";

const ehMunicipal = (t: Pick<ImpostoDaLista, "tributo">) => t.tributo === "ISS" || t.tributo === "ISS_RET";

/** A chave do imposto na seleção e no lote — única entre os tipos. */
export const chaveDoLoteImposto = (t: Pick<ImpostoDaLista, "id">) => `imposto|${t.id}`;

/** "PIS · cota 1/3". */
export const tituloDoImposto = (t: Pick<ImpostoDaLista, "titulo" | "cota_numero" | "cota_total">) =>
  `${t.titulo}${t.cota_numero ? ` · cota ${t.cota_numero}/${t.cota_total}` : ""}`;

/** "DARF 6912", "Guia municipal · Salvador-BA" ou a descrição. */
export function referenciaDoImposto(
  t: Pick<ImpostoDaLista, "codigo_receita" | "tributo" | "municipio" | "local" | "descricao">,
): string {
  if (t.codigo_receita) return `DARF ${t.codigo_receita}`;
  if (ehMunicipal(t)) return `Guia municipal · ${t.municipio ?? t.local}`;
  return t.descricao;
}

/** Quem recebe: a prefeitura do CNPJ (guia municipal) ou a Receita Federal. */
export function orgaoDoImposto(t: Pick<ImpostoDaLista, "tributo" | "municipio">): string {
  if (ehMunicipal(t) && t.municipio) return `Prefeitura de ${t.municipio.replace(/-[A-Z]{2}$/, "")}`;
  return ORGAO_FEDERAL;
}

/** O imposto em aberto no formato do lote: baixado pelo valor inteiro. */
export function paraOLoteImposto(t: ImpostoDaLista): TituloParaLote {
  return {
    chave: chaveDoLoteImposto(t),
    tipo: "imposto",
    alvo: { modulo: "imposto", id: t.id },
    titulo: tituloDoImposto(t),
    referencia: referenciaDoImposto(t),
    contraparte: orgaoDoImposto(t),
    vencimento: t.vencimento,
    aberto: t.valor,
    // O centro de custo vem do imposto (o banco escolhe), não do lote.
    centroDeCusto: null,
    imposto: {
      guiaPath: t.guia_path,
      empresaContabilId: t.empresa_contabil_id,
      pj: t.pj,
    },
  };
}
