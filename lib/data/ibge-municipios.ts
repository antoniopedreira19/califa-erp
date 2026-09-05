/**
 * Fonte IBGE de municípios brasileiros, com cache no processo.
 *
 * Alimenta o combobox híbrido do campo Cidade: quando o usuário digita e
 * não acha nada no cadastro local, sugerimos daqui e cadastramos em 1
 * clique. Ver docs: `app/(app)/orcamentos/cidade-combobox.tsx` e a
 * decisão de "Opção C" (2026-09-05).
 *
 * A API pública do IBGE não tem SLA — cacheamos os 5.570 municípios em
 * memória por 24h. Uma cold start baixa o JSON (~200KB) uma vez e as
 * demais chamadas leem o array em memória sem I/O.
 */

const IBGE_URL =
  "https://servicodosdados.ibge.gov.br/api/v1/localidades/municipios";

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface MunicipioIBGE {
  /** Código IBGE de 7 dígitos, chave estável na base oficial. */
  codigo: string;
  nome: string;
  /** Sigla UF (2 chars). */
  uf: string;
  /** Chave de busca sem acento/case pra `startsWith`/`includes`. */
  chaveBusca: string;
}

interface CacheState {
  data: MunicipioIBGE[] | null;
  loadedAt: number;
  pending: Promise<MunicipioIBGE[]> | null;
}

const cache: CacheState = { data: null, loadedAt: 0, pending: null };

// Formato bruto que a API do IBGE devolve — só o que a gente usa.
interface RawIBGE {
  id: number;
  nome: string;
  microrregiao?: {
    mesorregiao?: {
      UF?: { sigla?: string };
    };
  };
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

async function fetchIBGE(): Promise<MunicipioIBGE[]> {
  const res = await fetch(IBGE_URL, {
    // Cache do runtime do Next não precisa cachear — já cacheamos no módulo.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`IBGE ${res.status}: ${res.statusText}`);
  }
  const raw = (await res.json()) as RawIBGE[];
  return raw
    .map<MunicipioIBGE | null>((m) => {
      const uf = m.microrregiao?.mesorregiao?.UF?.sigla;
      if (!uf) return null;
      return {
        codigo: String(m.id),
        nome: m.nome,
        uf,
        chaveBusca: normalizar(m.nome),
      };
    })
    .filter((m): m is MunicipioIBGE => m !== null)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

async function getMunicipios(): Promise<MunicipioIBGE[]> {
  const agora = Date.now();
  if (cache.data && agora - cache.loadedAt < TTL_MS) return cache.data;
  if (cache.pending) return cache.pending;

  cache.pending = fetchIBGE()
    .then((data) => {
      cache.data = data;
      cache.loadedAt = Date.now();
      cache.pending = null;
      return data;
    })
    .catch((err) => {
      cache.pending = null;
      throw err;
    });

  return cache.pending;
}

/**
 * Busca no IBGE por prefixo, retornando no máximo `limite` resultados
 * ordenados alfabeticamente. Devolve `[]` em caso de falha (a busca IBGE
 * é oportunista: se o IBGE está fora, o combobox segue funcionando com o
 * cadastro local).
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
