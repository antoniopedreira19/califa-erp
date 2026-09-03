import type { TipoCusto } from "@/lib/types";
import type { GrupoLido, ItemLido, SecaoLida } from "./parser-projeto";

/**
 * O que muda entre a planilha importada e a versão vigente de um
 * orçamento — a conta da importação do projeto (decisão 041).
 *
 * Puro: recebe a seção lida e o conteúdo atual da versão, devolve o plano
 * da versão nova. Quem grava é a Server Action; quem mostra o preview lê
 * o `resumo`.
 *
 * Regras:
 * - Linha casada por **id** (coluna oculta). Sem id, a reserva é grupo +
 *   descrição, entre as linhas ainda não casadas.
 * - Linha casada **mantém o planejado** (e categoria, rastro e a marca
 *   de save) e recebe o orçado da planilha.
 * - Linha sem par na versão é **nova**, com planejado zerado.
 * - Linha da versão sem par na planilha foi **apagada** — e o planejado
 *   dela vai junto.
 * - Só o CONTEÚDO orçado conta como alteração: descrição, tipo, R$, QT,
 *   D/M, grupo (mover, renomear, criar, apagar) e linhas novas/apagadas.
 *   Reordenar linhas sem mudar nada não gera versão.
 */

export interface ItemAtual {
  id: string;
  grupo_id: string;
  ordem: number;
  item: string;
  tipo_custo: TipoCusto;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
  categoria_id: string | null;
  planilha_origem: string | null;
  em_save: boolean;
}

export interface GrupoAtual {
  id: string;
  nome: string;
  ordem: number;
}

export type SituacaoItem = "igual" | "alterado" | "novo";

export interface ItemPlanejado {
  situacao: SituacaoItem;
  /** A linha da versão que esta linha continua. `null` em linha nova. */
  origem: ItemAtual | null;
  item: string;
  tipo_custo: TipoCusto;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  linha_xlsx: number;
  /** Casada pela reserva (grupo + descrição), não pelo id. */
  casadaPorDescricao: boolean;
}

export interface GrupoPlanejado {
  origem: GrupoAtual | null;
  nome: string;
  renomeado: boolean;
  itens: ItemPlanejado[];
}

export interface ResumoDoPlano {
  alterados: number;
  novos: number;
  apagados: number;
  iguais: number;
  gruposNovos: number;
  gruposApagados: number;
  gruposRenomeados: number;
  /** Linhas casadas sem id — a reserva por descrição entrou em ação. */
  casadasPorDescricao: number;
  orcadoAntes: number;
  orcadoDepois: number;
}

export interface PlanoDaSecao {
  grupos: GrupoPlanejado[];
  apagados: ItemAtual[];
  gruposApagados: GrupoAtual[];
  /** Há o que gravar: alguma linha ou grupo mudou. */
  alterado: boolean;
  resumo: ResumoDoPlano;
}

const chave = (s: string) => s.trim().toLocaleLowerCase("pt-BR");
const iguais = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function totalOrcado(it: {
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
}): number {
  return it.valor_unitario_orcado * it.quantidade_orcada * it.dias_meses_orcado;
}

export function planejarSecao(
  secao: SecaoLida,
  gruposAtuais: GrupoAtual[],
  itensAtuais: ItemAtual[],
): PlanoDaSecao {
  const grupoPorId = new Map(gruposAtuais.map((g) => [g.id, g]));
  const itemPorId = new Map(itensAtuais.map((i) => [i.id, i]));
  const gruposUsados = new Set<string>();
  const itensUsados = new Set<string>();

  // ---------- grupos ----------
  const casarGrupo = (lido: GrupoLido): GrupoAtual | null => {
    if (lido.grupoId && grupoPorId.has(lido.grupoId) && !gruposUsados.has(lido.grupoId)) {
      gruposUsados.add(lido.grupoId);
      return grupoPorId.get(lido.grupoId)!;
    }
    const porNome = gruposAtuais.find(
      (g) => !gruposUsados.has(g.id) && chave(g.nome) === chave(lido.nome),
    );
    if (porNome) {
      gruposUsados.add(porNome.id);
      return porNome;
    }
    return null;
  };

  const gruposPlanejados: GrupoPlanejado[] = secao.grupos.map((lido) => {
    const origem = casarGrupo(lido);
    return {
      origem,
      nome: lido.nome.trim(),
      renomeado: origem !== null && origem.nome.trim() !== lido.nome.trim(),
      itens: [],
    };
  });

  // ---------- itens ----------
  const casarItem = (
    lido: ItemLido,
    grupoOrigem: GrupoAtual | null,
  ): { origem: ItemAtual | null; porDescricao: boolean } => {
    if (lido.itemId && itemPorId.has(lido.itemId) && !itensUsados.has(lido.itemId)) {
      itensUsados.add(lido.itemId);
      return { origem: itemPorId.get(lido.itemId)!, porDescricao: false };
    }
    // Reserva: mesma descrição, no grupo de origem correspondente. Só
    // quando o id não veio — se veio e não bate, a linha é nova (ou a
    // versão mudou por baixo, e o preview avisa).
    if (!lido.itemId && grupoOrigem) {
      const porDescricao = itensAtuais.find(
        (i) =>
          !itensUsados.has(i.id) &&
          i.grupo_id === grupoOrigem.id &&
          chave(i.item) === chave(lido.item),
      );
      if (porDescricao) {
        itensUsados.add(porDescricao.id);
        return { origem: porDescricao, porDescricao: true };
      }
    }
    return { origem: null, porDescricao: false };
  };

  let alterados = 0;
  let novos = 0;
  let iguaisCount = 0;
  let casadasPorDescricao = 0;
  let orcadoDepois = 0;

  secao.grupos.forEach((lido, i) => {
    const plano = gruposPlanejados[i];
    for (const item of lido.itens) {
      const { origem, porDescricao } = casarItem(item, plano.origem);
      if (porDescricao) casadasPorDescricao++;
      orcadoDepois += totalOrcado(item);

      let situacao: SituacaoItem = "novo";
      if (origem) {
        const mudou =
          origem.item.trim() !== item.item.trim() ||
          origem.tipo_custo !== item.tipo_custo ||
          !iguais(origem.valor_unitario_orcado, item.valor_unitario_orcado) ||
          !iguais(origem.quantidade_orcada, item.quantidade_orcada) ||
          !iguais(origem.dias_meses_orcado, item.dias_meses_orcado) ||
          // Mudou de grupo: o grupo de destino tem outra origem (ou é novo).
          (plano.origem ? plano.origem.id !== origem.grupo_id : true);
        situacao = mudou ? "alterado" : "igual";
      }
      if (situacao === "novo") novos++;
      else if (situacao === "alterado") alterados++;
      else iguaisCount++;

      plano.itens.push({
        situacao,
        origem,
        item: item.item.trim(),
        tipo_custo: item.tipo_custo,
        valor_unitario_orcado: item.valor_unitario_orcado,
        quantidade_orcada: item.quantidade_orcada,
        dias_meses_orcado: item.dias_meses_orcado,
        linha_xlsx: item.linha_xlsx,
        casadaPorDescricao: porDescricao,
      });
    }
  });

  const apagados = itensAtuais.filter((i) => !itensUsados.has(i.id));
  const gruposApagados = gruposAtuais.filter((g) => !gruposUsados.has(g.id));
  const gruposNovos = gruposPlanejados.filter((g) => g.origem === null).length;
  const gruposRenomeados = gruposPlanejados.filter((g) => g.renomeado).length;
  const orcadoAntes = itensAtuais.reduce((s, i) => s + totalOrcado(i), 0);

  const alterado =
    alterados > 0 ||
    novos > 0 ||
    apagados.length > 0 ||
    gruposNovos > 0 ||
    gruposApagados.length > 0 ||
    gruposRenomeados > 0;

  return {
    grupos: gruposPlanejados,
    apagados,
    gruposApagados,
    alterado,
    resumo: {
      alterados,
      novos,
      apagados: apagados.length,
      iguais: iguaisCount,
      gruposNovos,
      gruposApagados: gruposApagados.length,
      gruposRenomeados,
      casadasPorDescricao,
      orcadoAntes,
      orcadoDepois,
    },
  };
}
