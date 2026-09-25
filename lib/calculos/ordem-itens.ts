/**
 * Ordem dos itens da planilha da versão — decisão 104.
 *
 * O item se reordena arrastando pela alça (ou com Alt + ↑ ↓) e pode trocar
 * de agrupamento. Esta é a regra do movimento, num lugar só: a tela da
 * versão a usa para mostrar o resultado antes de o servidor responder, a
 * server action a usa para calcular o que gravar, e o rascunho da visão
 * agregada a usa no estado do React.
 *
 * `ordem` é GLOBAL na versão (como já era em `adicionarItem`, na cópia de
 * mês e no salvamento da agregada): a tela ordena os grupos pela ordem
 * deles e, dentro de cada grupo, os itens pela `ordem` do item. Por isso
 * a renumeração percorre grupo por grupo e dá 1..N na sequência da tela.
 */

/** O mínimo que um grupo precisa ter para o item se mover nele. */
export interface GrupoComItens<T extends { id: string }> {
  id: string;
  itens: T[];
}

/** O que se grava de cada item depois do movimento. */
export interface OrdemDoItem {
  id: string;
  grupo_id: string;
  ordem: number;
}

/**
 * Move o item para `grupoDestinoId`, na posição `indice` — contada entre
 * os itens do grupo de destino SEM o item que se move (é o que a linha de
 * inserção da tela mede). Índice fora da faixa vai para a ponta mais
 * próxima.
 *
 * Devolve `null` quando nada muda (mesmo grupo, mesma posição) ou quando
 * o item ou o grupo não existem na lista — quem chama decide se isso é
 * erro. Nunca muta a lista recebida: grupos tocados saem copiados, os
 * demais saem como estavam.
 */
export function moverNaLista<T extends { id: string }, G extends GrupoComItens<T>>(
  grupos: G[],
  itemId: string,
  grupoDestinoId: string,
  indice: number,
): G[] | null {
  const origem = grupos.find((g) => g.itens.some((i) => i.id === itemId));
  const destino = grupos.find((g) => g.id === grupoDestinoId);
  if (!origem || !destino) return null;

  const posAtual = origem.itens.findIndex((i) => i.id === itemId);
  const item = origem.itens[posAtual];
  const semOItem = destino.itens.filter((i) => i.id !== itemId);
  const alvo = Math.max(0, Math.min(Math.trunc(indice), semOItem.length));

  if (origem.id === destino.id && alvo === posAtual) return null;

  const novoDestino = [...semOItem.slice(0, alvo), item, ...semOItem.slice(alvo)];
  return grupos.map((g) => {
    if (g.id === destino.id) return { ...g, itens: novoDestino };
    if (g.id === origem.id) return { ...g, itens: g.itens.filter((i) => i.id !== itemId) };
    return g;
  });
}

/**
 * Para onde o item vai com Alt + ↑ (`-1`) ou Alt + ↓ (`+1`): uma posição
 * dentro do grupo e, na ponta, o fim do grupo de cima ou o começo do de
 * baixo. `null` quando não há para onde ir (primeiro item do primeiro
 * grupo, último do último).
 */
export function destinoPorTecla<T extends { id: string }>(
  grupos: GrupoComItens<T>[],
  itemId: string,
  direcao: -1 | 1,
): { grupoId: string; indice: number } | null {
  const gi = grupos.findIndex((g) => g.itens.some((i) => i.id === itemId));
  if (gi < 0) return null;
  const grupo = grupos[gi];
  const pos = grupo.itens.findIndex((i) => i.id === itemId);
  const nova = pos + direcao;
  if (nova >= 0 && nova < grupo.itens.length) {
    return { grupoId: grupo.id, indice: nova };
  }
  const vizinho = grupos[gi + direcao];
  if (!vizinho) return null;
  return {
    grupoId: vizinho.id,
    indice: direcao < 0 ? vizinho.itens.length : 0,
  };
}

/** Numera 1..N na sequência da tela: grupo por grupo, item por item. */
export function numerarItens<T extends { id: string }>(
  grupos: GrupoComItens<T>[],
): OrdemDoItem[] {
  let ordem = 0;
  const saida: OrdemDoItem[] = [];
  for (const g of grupos) {
    for (const it of g.itens) {
      ordem += 1;
      saida.push({ id: it.id, grupo_id: g.id, ordem });
    }
  }
  return saida;
}

/**
 * Monta os grupos como a tela os mostra a partir das linhas do banco:
 * grupos pela `ordem` deles, itens pela `ordem` do item. O desempate pelo
 * id só existe para o resultado não depender da ordem em que o banco
 * devolveu as linhas.
 */
export function gruposNaOrdemDaTela(
  grupos: { id: string; ordem: number }[],
  itens: { id: string; grupo_id: string; ordem: number }[],
): GrupoComItens<{ id: string }>[] {
  const porOrdem = <X extends { id: string; ordem: number }>(a: X, b: X) =>
    a.ordem - b.ordem || a.id.localeCompare(b.id);
  return [...grupos].sort(porOrdem).map((g) => ({
    id: g.id,
    itens: itens
      .filter((i) => i.grupo_id === g.id)
      .sort(porOrdem)
      .map((i) => ({ id: i.id })),
  }));
}

/** Só as linhas cuja ordem ou grupo mudaram — é o que vai ao banco. */
export function ordensAlteradas(
  atuais: { id: string; grupo_id: string; ordem: number }[],
  novas: OrdemDoItem[],
): OrdemDoItem[] {
  const porId = new Map(atuais.map((a) => [a.id, a]));
  return novas.filter((n) => {
    const a = porId.get(n.id);
    return !a || a.ordem !== n.ordem || a.grupo_id !== n.grupo_id;
  });
}
