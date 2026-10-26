/**
 * A PP no cartão corporativo (decisão 209, 23/10/2026): a compra que o
 * financeiro paga no cartão de crédito da empresa, sem fornecedor. No lugar
 * dele, a plataforma (ou o site) e o link da compra.
 *
 * A mesma régua na tela (`cartao-corporativo-field.tsx`) e no servidor
 * (`actions-pp.ts`); as CHECKs `pp_cartao_corporativo` e
 * `chk_ppae_cartao_corporativo` repetem os limites de tamanho.
 */

/** Um endereço de site, com ou sem "https://": "loja.com.br/produto". */
export const LINK_DA_COMPRA = /^(https?:\/\/)?[^/\s.]+\.[^\s]{2,}$/i;

export const PLATAFORMA_MAX = 200;
export const LINK_DA_COMPRA_MAX = 2000;

export function problemaDaPlataforma(plataforma: string): string | null {
  const p = plataforma.trim();
  if (!p) return "Informe a plataforma.";
  if (p.length > PLATAFORMA_MAX) return `A plataforma tem mais de ${PLATAFORMA_MAX} caracteres.`;
  return null;
}

export function problemaDoLinkDaCompra(link: string): string | null {
  const l = link.trim();
  if (!l) return "Cole o link da compra.";
  if (l.length > LINK_DA_COMPRA_MAX) return `O link tem mais de ${LINK_DA_COMPRA_MAX} caracteres.`;
  if (!LINK_DA_COMPRA.test(l)) return "Isso não parece um link: confira o endereço.";
  return null;
}

/** O link como endereço que abre: sem "http(s)://", ganha "https://" — e
 *  assim nenhum outro esquema (javascript:, data:) chega ao `href`. */
export function hrefDoLinkDaCompra(link: string): string {
  const l = link.trim();
  return /^https?:\/\//i.test(l) ? l : `https://${l}`;
}
