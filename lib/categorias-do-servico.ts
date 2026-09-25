/**
 * Quais categorias um serviço aceita — decisões 078 e 105.
 *
 * Pedido do Tiago (12/09/2026): escolhido o serviço Fee, a única categoria
 * possível é Fee; o mesmo com Always On. E essas categorias só existem para
 * os seus serviços.
 *
 * Exceção da 105 (25/09/2026): o serviço de investimento interno (Interno)
 * não aceita a categoria internacional e aceita, além das nacionais, a
 * categoria Always On — marcada `aceita_servico_interno` —, para o
 * investimento recorrente sair na planilha mensal.
 *
 * As relações são os campos `servico_exclusivo_id`, `investimento_interno`
 * e `aceita_servico_interno`, nunca o nome. Sem "use client" e sem banco: o
 * formulário usa para filtrar o Select, a server action usa para recusar o
 * que o formulário não deixaria passar — a MESMA função, para as duas
 * pontas não divergirem. O banco confere o mesmo par no gatilho
 * `orcamento_servico_e_categoria_coerentes`.
 */

import type { CategoriaDominio } from "@/lib/types";

export type CategoriaParaServico = Pick<
  CategoriaDominio,
  | "id"
  | "nome"
  | "modelo_planilha"
  | "servico_exclusivo_id"
  | "aceita_servico_interno"
>;

/** O que as regras precisam saber do serviço escolhido. */
export type ServicoParaCategoria = Pick<
  CategoriaDominio,
  "id" | "investimento_interno"
>;

/** As categorias que o serviço aceita. Serviço com categoria exclusiva só
 *  aceita as dele; o Interno aceita as nacionais e as marcadas para ele;
 *  os demais aceitam as que não são exclusivas de ninguém. Sem serviço
 *  escolhido ainda, também só as não exclusivas. */
export function categoriasDoServico<T extends CategoriaParaServico>(
  servico: ServicoParaCategoria | null | undefined,
  categorias: T[],
): T[] {
  if (servico?.investimento_interno) {
    return categorias.filter(
      (c) =>
        c.modelo_planilha !== "internacional" &&
        (c.servico_exclusivo_id === null || c.aceita_servico_interno),
    );
  }
  const exclusivas = servico
    ? categorias.filter((c) => c.servico_exclusivo_id === servico.id)
    : [];
  if (exclusivas.length > 0) return exclusivas;
  return categorias.filter((c) => c.servico_exclusivo_id === null);
}

/** `true` quando o serviço tem categoria exclusiva — o Select da categoria
 *  vira campo travado. */
export function servicoTemCategoriaExclusiva(
  servico: ServicoParaCategoria | null | undefined,
  categorias: CategoriaParaServico[],
): boolean {
  return Boolean(
    servico && categorias.some((c) => c.servico_exclusivo_id === servico.id),
  );
}

/** A frase de recusa para um par serviço × categoria, ou `null` quando o
 *  par é válido. */
export function erroDoParServicoCategoria(
  servico: ServicoParaCategoria,
  categoria: CategoriaParaServico,
  categorias: CategoriaParaServico[],
  nomeDoServico: string,
): string | null {
  const permitidas = categoriasDoServico(servico, categorias);
  if (permitidas.some((c) => c.id === categoria.id)) return null;
  if (servico.investimento_interno && categoria.modelo_planilha === "internacional") {
    return `O serviço ${nomeDoServico} não aceita a categoria ${categoria.nome}.`;
  }
  if (servicoTemCategoriaExclusiva(servico, categorias)) {
    const nomes = permitidas.map((c) => c.nome).join(" ou ");
    return `Com o serviço ${nomeDoServico}, a categoria é ${nomes}.`;
  }
  return `A categoria ${categoria.nome} é só para o serviço dela.`;
}
