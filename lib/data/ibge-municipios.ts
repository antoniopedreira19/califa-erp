/**
 * Municípios brasileiros do IBGE, lidos de `municipios-ibge.json`.
 *
 * Alimenta o combobox híbrido do campo Cidade: quando o usuário digita e
 * não acha nada no cadastro local, sugerimos daqui e cadastramos em 1
 * clique. Ver docs: `app/(app)/orcamentos/cidade-combobox.tsx` e a
 * decisão de "Opção C" (2026-09-05).
 *
 * Até 22/10/2026 a lista vinha da API pública do IBGE a cada cold start.
 * Desde ~16/10 o IBGE não atende a Vercel e cada busca esperava 10 s pela
 * conexão; a lista agora mora no repositório (184 KB, 5.571 municípios) e
 * se atualiza com `node scripts/atualizar-municipios-ibge.mjs`.
 *
 * O JSON entra por `import()` dinâmico: só a busca o carrega, uma vez por
 * instância, e as páginas que importam `lib/data/cidades.ts` não pagam.
 */

export interface MunicipioIBGE {
  /** Código IBGE de 7 dígitos, chave estável na base oficial. */
  codigo: string;
  nome: string;
  /** Sigla UF (2 chars). */
  uf: string;
  /** Chave de busca sem acento/case pra `startsWith`/`includes`. */
  chaveBusca: string;
}

let municipios: Promise<MunicipioIBGE[]> | null = null;

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getMunicipios(): Promise<MunicipioIBGE[]> {
  municipios ??= import("./municipios-ibge.json")
    .then((mod) =>
      (mod.default as [string, string, string][]).map(([codigo, nome, uf]) => ({
        codigo,
        nome,
        uf,
        chaveBusca: normalizar(nome),
      })),
    )
    .catch((err) => {
      municipios = null;
      throw err;
    });
  return municipios;
}

/** O município oficial daquele código, ou `null` se o código não existe. */
export async function municipioPorCodigo(
  codigo: string,
): Promise<MunicipioIBGE | null> {
  const todos = await getMunicipios();
  return todos.find((m) => m.codigo === codigo) ?? null;
}

/**
 * Busca no IBGE por prefixo, retornando no máximo `limite` resultados
 * ordenados alfabeticamente. Devolve `[]` em caso de falha (a busca IBGE
 * é oportunista: o combobox segue funcionando com o cadastro local).
 */
export async function buscarMunicipiosIBGE(
  termo: string,
  limite = 20,
): Promise<MunicipioIBGE[]> {
  const q = normalizar(termo.trim());
  if (q.length < 2) return [];

  try {
    const todos = await getMunicipios();
    const resultados: MunicipioIBGE[] = [];
    // startsWith prioriza matches no começo do nome.
    for (const m of todos) {
      if (m.chaveBusca.startsWith(q)) {
        resultados.push(m);
        if (resultados.length >= limite) return resultados;
      }
    }
    // Se sobrou espaço, completa com matches em qualquer posição.
    if (resultados.length < limite) {
      for (const m of todos) {
        if (!m.chaveBusca.startsWith(q) && m.chaveBusca.includes(q)) {
          resultados.push(m);
          if (resultados.length >= limite) return resultados;
        }
      }
    }
    return resultados;
  } catch (err) {
    console.error("[ibge-municipios]", err instanceof Error ? err.message : err);
    return [];
  }
}
