/**
 * Decisão 226 (28/10/2026): a linha vermelha não é errata.
 *
 * A tela continua montando um rascunho só — o modo de edição da planilha do
 * job junta correções, linhas novas, cancelamentos, organização e linhas
 * vermelhas. Antes de gravar, o servidor separa as linhas vermelhas NOVAS:
 * elas entram direto (`adicionar_linhas_vermelhas_do_job`), sem errata, sem
 * mural e sem esperar o GP; o resto segue como errata (ou errata pronta).
 *
 * As linhas novas do rascunho são posicionais (a N-ésima é `nova:N` na
 * organização, decisão 162). Tirar as vermelhas renumera as que ficam, e a
 * vermelha que aparece na nova ordem vira um marcador que o servidor troca
 * pelo id dela depois de gravá-la (`trocarMarcadores`).
 *
 * Fica na errata a vermelha criada num agrupamento novo desta mesma errata:
 * o agrupamento só passa a existir quando a errata é registrada.
 *
 * Rodar o teste: `npm run test:linha-vermelha-fora-da-errata`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAVE_NOVA = /^nova:(\d+)$/;
/** O marcador da linha vermelha na nova ordem, até ela ganhar id. */
export const PREFIXO_MARCADOR = "vermelha:";

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

interface ConteudoMinimo<N extends NovaMinima, O extends OrdemMinima> {
  novas: N[];
  estrutura?: { ordem: O[] | null } | null;
}

/** A linha vermelha que entra sem errata, com a chave que ela tinha no
 *  rascunho (`nova:N`), para a tela tirá-la do rascunho. */
export interface LinhaVermelhaSeparada {
  chave: string;
  grupo_id: string;
  item: string;
  tipo_custo: string;
}

/** A linha vermelha nova que sai da errata: num agrupamento que já existe. */
export function vermelhaForaDaErrata(n: NovaMinima): boolean {
  return n.linha_vermelha && UUID.test(n.grupo_id);
}

export function separarLinhasVermelhas<
  N extends NovaMinima,
  O extends OrdemMinima,
  C extends ConteudoMinimo<N, O>,
>(conteudo: C): { conteudo: C; vermelhas: LinhaVermelhaSeparada[] } {
  const vermelhas: LinhaVermelhaSeparada[] = [];
  const ficam: N[] = [];
  /** `nova:N` antigo → o que entra no lugar dele na nova ordem. */
  const troca = new Map<string, string>();
  conteudo.novas.forEach((n, k) => {
    const chave = `nova:${k + 1}`;
    if (vermelhaForaDaErrata(n)) {
      vermelhas.push({ chave, grupo_id: n.grupo_id, item: n.item.trim(), tipo_custo: n.tipo_custo });
      troca.set(chave, `${PREFIXO_MARCADOR}${chave}`);
    } else {
      ficam.push(n);
      troca.set(chave, `nova:${ficam.length}`);
    }
  });
  if (vermelhas.length === 0) return { conteudo, vermelhas };

  const est = conteudo.estrutura ?? null;
  const ordem = est?.ordem
    ? est.ordem.map((o) => (CHAVE_NOVA.test(o.item) ? { ...o, item: troca.get(o.item) ?? o.item } : o))
    : (est?.ordem ?? null);
  return {
    conteudo: {
      ...conteudo,
      novas: ficam,
      ...(est ? { estrutura: { ...est, ordem } } : {}),
    },
    vermelhas,
  };
}

/** Troca o marcador da vermelha na nova ordem pelo id que ela ganhou. */
export function trocarMarcadores<O extends OrdemMinima, C extends { estrutura?: { ordem: O[] | null } | null }>(
  conteudo: C,
  ids: Record<string, string>,
): C {
  const est = conteudo.estrutura ?? null;
  if (!est?.ordem) return conteudo;
  return {
    ...conteudo,
    estrutura: {
      ...est,
      ordem: est.ordem.map((o) =>
        o.item.startsWith(PREFIXO_MARCADOR)
          ? { ...o, item: ids[o.item.slice(PREFIXO_MARCADOR.length)] ?? o.item }
          : o,
      ),
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
