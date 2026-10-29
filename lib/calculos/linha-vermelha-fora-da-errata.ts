/**
 * Decisão 226 (28/10/2026): a linha vermelha não é errata.
 *
 * A tela continua montando um rascunho só — o modo de edição da planilha do
 * job junta correções, linhas novas, cancelamentos, organização e linhas
 * vermelhas. Antes de gravar, o servidor separa as linhas vermelhas NOVAS:
 * elas entram direto (`adicionar_linhas_vermelhas_do_job`), sem errata, sem
 * mural e sem esperar o GP; o resto segue como errata (ou errata pronta).
 *
 * Revisão de 29/10/2026: o agrupamento novo composto APENAS por linhas
 * vermelhas novas sai junto com elas. O que recebe também item normal ou
 * linha movida continua errata, com as vermelhas dentro — o agrupamento só
 * nasce com a errata (decisão 162). O agrupamento novo de um mês novo da
 * errata (decisão 219) também fica nela.
 *
 * As linhas novas e os agrupamentos novos do rascunho são posicionais (`nova:N`,
 * `grupo-novo:N`). Tirar o que sai renumera o que fica, e o que sai e aparece
 * na nova ordem vira um marcador que o servidor troca pelo id depois de
 * gravar (`trocarMarcadores`).
 *
 * Rodar o teste: `npm run test:linha-vermelha-fora-da-errata`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAVE_NOVA = /^nova:(\d+)$/;
const CHAVE_GRUPO_NOVO = /^grupo-novo:(\d+)$/;
/** O marcador da linha vermelha na nova ordem, até ela ganhar id. */
export const PREFIXO_MARCADOR = "vermelha:";
/** O marcador do agrupamento novo só de vermelhas, até ele ganhar id. */
export const PREFIXO_MARCADOR_GRUPO = "vermelha-grupo:";

interface NovaMinima {
  grupo_id: string;
  item: string;
  tipo_custo: string;
  linha_vermelha: boolean;
}

interface OrdemMinima {
  item: string;
  grupo: string;
}

interface GrupoNovoMinimo {
  chave: string;
  nome: string;
  mes_id: string | null;
}

interface EstruturaMinima<O extends OrdemMinima, G extends GrupoNovoMinimo> {
  grupos_novos: G[];
  ordem: O[] | null;
}

interface ConteudoMinimo<N extends NovaMinima, O extends OrdemMinima, G extends GrupoNovoMinimo> {
  novas: N[];
  estrutura?: EstruturaMinima<O, G> | null;
}

/** A linha vermelha que entra sem errata, com a chave que ela tinha no
 *  pedido (`nova:N`), para a tela tirá-la do rascunho. `grupo_id` é o id do
 *  agrupamento do job ou a chave de um agrupamento novo que sai junto. */
export interface LinhaVermelhaSeparada {
  chave: string;
  grupo_id: string;
  item: string;
  tipo_custo: string;
}

/** O agrupamento novo só de linhas vermelhas, que sai junto com elas. */
export interface GrupoNovoSeparado {
  chave: string;
  nome: string;
  mes_id: string | null;
}

/** Os agrupamentos novos do pedido compostos só por linhas vermelhas novas:
 *  ao menos uma, nenhuma linha normal e nenhuma linha que já existia levada
 *  para ele. O de mês novo (`mes-novo:`) fica de fora. */
export function gruposSoDeVermelhas<N extends NovaMinima, O extends OrdemMinima, G extends GrupoNovoMinimo>(
  c: ConteudoMinimo<N, O, G>,
): Set<string> {
  const est = c.estrutura ?? null;
  const saem = new Set<string>();
  for (const g of est?.grupos_novos ?? []) {
    if (g.mes_id !== null && !UUID.test(g.mes_id)) continue;
    const doGrupo = c.novas.filter((n) => n.grupo_id === g.chave);
    if (doGrupo.length === 0 || doGrupo.some((n) => !n.linha_vermelha)) continue;
    const levadas = (est?.ordem ?? []).some((o) => o.grupo === g.chave && !CHAVE_NOVA.test(o.item));
    if (levadas) continue;
    saem.add(g.chave);
  }
  return saem;
}

export function separarLinhasVermelhas<
  N extends NovaMinima,
  O extends OrdemMinima,
  G extends GrupoNovoMinimo,
  C extends ConteudoMinimo<N, O, G>,
>(conteudo: C): { conteudo: C; vermelhas: LinhaVermelhaSeparada[]; grupos: GrupoNovoSeparado[] } {
  const est = conteudo.estrutura ?? null;
  const gruposQueSaem = gruposSoDeVermelhas<N, O, G>(conteudo);

  // Os agrupamentos novos que ficam, renumerados; os que saem, marcados.
  const trocaDoGrupo = new Map<string, string>();
  const grupos: GrupoNovoSeparado[] = [];
  const gruposFicam: G[] = [];
  for (const g of est?.grupos_novos ?? []) {
    if (gruposQueSaem.has(g.chave)) {
      grupos.push({ chave: g.chave, nome: g.nome.trim(), mes_id: g.mes_id });
      trocaDoGrupo.set(g.chave, `${PREFIXO_MARCADOR_GRUPO}${g.chave}`);
    } else {
      gruposFicam.push(g);
      trocaDoGrupo.set(g.chave, `grupo-novo:${gruposFicam.length}`);
    }
  }
  const grupoDe = (ref: string) => (CHAVE_GRUPO_NOVO.test(ref) ? (trocaDoGrupo.get(ref) ?? ref) : ref);

  const vermelhas: LinhaVermelhaSeparada[] = [];
  const ficam: N[] = [];
  /** `nova:N` antigo → o que entra no lugar dele na nova ordem. */
  const troca = new Map<string, string>();
  conteudo.novas.forEach((n, k) => {
    const chave = `nova:${k + 1}`;
    if (n.linha_vermelha && (UUID.test(n.grupo_id) || gruposQueSaem.has(n.grupo_id))) {
      vermelhas.push({ chave, grupo_id: n.grupo_id, item: n.item.trim(), tipo_custo: n.tipo_custo });
      troca.set(chave, `${PREFIXO_MARCADOR}${chave}`);
    } else {
      ficam.push({ ...n, grupo_id: grupoDe(n.grupo_id) });
      troca.set(chave, `nova:${ficam.length}`);
    }
  });
  if (vermelhas.length === 0) return { conteudo, vermelhas, grupos: [] };

  const ordem = est?.ordem
    ? est.ordem.map((o) => ({
        ...o,
        item: CHAVE_NOVA.test(o.item) ? (troca.get(o.item) ?? o.item) : o.item,
        grupo: grupoDe(o.grupo),
      }))
    : (est?.ordem ?? null);
  return {
    conteudo: {
      ...conteudo,
      novas: ficam,
      ...(est
        ? {
            estrutura: {
              ...est,
              grupos_novos: gruposFicam.map((g, k) => ({ ...g, chave: `grupo-novo:${k + 1}` })),
              ordem,
            },
          }
        : {}),
    },
    vermelhas,
    grupos,
  };
}

/** Troca os marcadores da nova ordem pelos ids que a linha vermelha e o
 *  agrupamento novo dela ganharam. */
export function trocarMarcadores<O extends OrdemMinima, C extends { estrutura?: { ordem: O[] | null } | null }>(
  conteudo: C,
  ids: Record<string, string>,
  idsDosGrupos: Record<string, string> = {},
): C {
  const est = conteudo.estrutura ?? null;
  if (!est?.ordem) return conteudo;
  return {
    ...conteudo,
    estrutura: {
      ...est,
      ordem: est.ordem.map((o) => ({
        ...o,
        item: o.item.startsWith(PREFIXO_MARCADOR)
          ? (ids[o.item.slice(PREFIXO_MARCADOR.length)] ?? o.item)
          : o.item,
        grupo: o.grupo.startsWith(PREFIXO_MARCADOR_GRUPO)
          ? (idsDosGrupos[o.grupo.slice(PREFIXO_MARCADOR_GRUPO.length)] ?? o.grupo)
          : o.grupo,
      })),
    },
  };
}

/** A errata ainda tem o que gravar depois de as vermelhas saírem. */
export function sobraErrata(c: {
  alteracoes: unknown[];
  novas: unknown[];
  cancelamentos: unknown[];
  remocoes?: unknown[];
  meses_novos?: unknown[];
  estrutura?: { grupos_novos: unknown[]; grupos_renomeados: unknown[]; ordem: unknown[] | null } | null;
}): boolean {
  const est = c.estrutura ?? null;
  return (
    c.alteracoes.length > 0 ||
    c.novas.length > 0 ||
    c.cancelamentos.length > 0 ||
    (c.remocoes?.length ?? 0) > 0 ||
    (c.meses_novos?.length ?? 0) > 0 ||
    (est !== null && (est.grupos_novos.length > 0 || est.grupos_renomeados.length > 0 || est.ordem !== null))
  );
}
