/**
 * Quais categorias um serviço aceita — decisão 078.
 *
 * Pedido do Tiago (12/09/2026): escolhido o serviço Fee, a única categoria
 * possível é Fee; o mesmo com Always On. E essas categorias só existem para
 * os seus serviços.
 *
 * A relação é o campo `categorias_dominio.servico_exclusivo_id`, nunca o
 * nome. Sem "use client" e sem banco: o formulário usa para filtrar o
 * Select, a server action usa para recusar o que o formulário não deixaria
 * passar — a MESMA função, para as duas pontas não divergirem.
 */

import type { CategoriaDominio } from "@/lib/types";

export type CategoriaParaServico = Pick<
  CategoriaDominio,
  "id" | "nome" | "modelo_planilha" | "servico_exclusivo_id"
>;

/** As categorias que o serviço aceita. Serviço com categoria exclusiva só
 *  aceita as dele; os demais aceitam as que não são exclusivas de ninguém.
 *  Sem serviço escolhido ainda, também só as não exclusivas. */
export function categoriasDoServico<T extends CategoriaParaServico>(
  servicoId: string | null | undefined,
  categorias: T[],
): T[] {
  const exclusivas = servicoId
    ? categorias.filter((c) => c.servico_exclusivo_id === servicoId)
    : [];
  if (exclusivas.length > 0) return exclusivas;
  return categorias.filter((c) => c.servico_exclusivo_id === null);
}

/** `true` quando o serviço tem categoria exclusiva — o Select da categoria
 *  vira campo travado. */
export function servicoTemCategoriaExclusiva(
  servicoId: string | null | undefined,
  categorias: CategoriaParaServico[],
): boolean {
  return Boolean(
    servicoId && categorias.some((c) => c.servico_exclusivo_id === servicoId),
  );
}

/** A frase de recusa para um par serviço × categoria, ou `null` quando o
 *  par é válido. */
export function erroDoParServicoCategoria(
  servicoId: string,
  categoria: CategoriaParaServico,
  categorias: CategoriaParaServico[],
  nomeDoServico: string,
): string | null {
  const permitidas = categoriasDoServico(servicoId, categorias);
  if (permitidas.some((c) => c.id === categoria.id)) return null;
  if (servicoTemCategoriaExclusiva(servicoId, categorias)) {
    const nomes = permitidas.map((c) => c.nome).join(" ou ");
    return `Com o serviço ${nomeDoServico}, a categoria é ${nomes}.`;
  }
  return `A categoria ${categoria.nome} é só para o serviço dela.`;
}
