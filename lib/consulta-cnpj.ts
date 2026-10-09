/**
 * A consulta pública do CNPJ no cadastro de fornecedor: razão social,
 * endereço e o regime (opção pelo Simples e pelo MEI — ver
 * `lib/fiscal/regime-do-fornecedor.ts`).
 *
 * BrasilAPI primeiro; quando ela falha, o CNPJ.ws (09/10/2026). Nesse dia a
 * BrasilAPI respondia 500 para todo CNPJ fora do cache dela (a origem,
 * minhareceita.org, estava em 503), e um GP achou que o cadastro estava
 * travado pelo CNPJ. As duas leem a mesma base aberta da Receita, que muda
 * uma vez por mês.
 *
 * O CNPJ.ws entra pela "API Gratuita" deles: sem cadastro nem chave, 3
 * consultas por minuto por IP (a 4ª volta 429 e espera 60 s). A chamada sai
 * do navegador de quem cadastra, como a da BrasilAPI — do servidor, o
 * limite seria dividido com o tráfego da Vercel inteira. A resposta é
 * convertida para os campos da BrasilAPI: a tela e o regime não sabem de
 * onde ela veio.
 *
 * Testes da conversão:
 * node --import tsx --test lib/consulta-cnpj.test.ts
 */

import { onlyDigits } from "@/lib/utils";

/** BrasilAPI bate na Receita e leva de 0,5 s a 2 s; fora do ar, uns 5 s. */
const TEMPO_MAXIMO_MS = 6000;

/** Os campos da resposta da BrasilAPI (`/api/cnpj/v1/{cnpj}`) que o
 *  cadastro lê. A do CNPJ.ws é convertida para eles. */
export interface RespostaDoCnpj {
  razao_social?: string | null;
  nome_fantasia?: string | null;
  descricao_situacao_cadastral?: string | null;
  cep?: string | number | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  opcao_pelo_simples?: boolean | null;
  opcao_pelo_mei?: boolean | null;
  data_opcao_pelo_simples?: string | null;
  data_opcao_pelo_mei?: string | null;
}

export type ConsultaDoCnpj =
  | { status: "ok"; dados: RespostaDoCnpj }
  | { status: "nao_encontrado" }
  | { status: "falhou" };

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/** Texto ou vazio — a BrasilAPI manda "" no campo que a Receita não tem. */
function texto(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

/** "Sim" / "Não" do CNPJ.ws. */
function sim(v: unknown): boolean {
  return typeof v === "string" && /^s/i.test(v.trim());
}

/**
 * A resposta do CNPJ.ws (`publica.cnpj.ws/cnpj/{cnpj}`) nos campos da
 * BrasilAPI. `simples` nulo é a empresa que nunca optou: Simples e MEI vão
 * como `false`, e a consulta deduz Lucro Real ou Presumido — o mesmo que a
 * BrasilAPI dá para ela. `null` quando a resposta não tem o estabelecimento.
 */
export function respostaDoCnpjWs(resposta: unknown): RespostaDoCnpj | null {
  const r = objeto(resposta);
  const estabelecimento = objeto(r?.estabelecimento);
  if (!r || !estabelecimento) return null;
  const simples = objeto(r.simples);
  const data = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    razao_social: texto(r.razao_social),
    nome_fantasia: texto(estabelecimento.nome_fantasia),
    descricao_situacao_cadastral: texto(estabelecimento.situacao_cadastral),
    cep: texto(estabelecimento.cep),
    logradouro: texto(estabelecimento.logradouro),
    numero: texto(estabelecimento.numero),
    complemento: texto(estabelecimento.complemento),
    bairro: texto(estabelecimento.bairro),
    municipio: texto(objeto(estabelecimento.cidade)?.nome),
    uf: texto(objeto(estabelecimento.estado)?.sigla),
    opcao_pelo_simples: simples ? sim(simples.simples) : false,
    opcao_pelo_mei: simples ? sim(simples.mei) : false,
    data_opcao_pelo_simples: simples ? data(simples.data_opcao_simples) : null,
    data_opcao_pelo_mei: simples ? data(simples.data_opcao_mei) : null,
  };
}

/** `fetch` com tempo máximo; rede fora ou tempo esgotado → `null`. */
async function buscar(url: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const tempo = setTimeout(() => ctrl.abort(), TEMPO_MAXIMO_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(tempo);
  }
}

/**
 * Consulta o CNPJ: BrasilAPI, e o CNPJ.ws quando ela não responde. 404 de
 * qualquer uma das duas é "não encontrado"; a falha das duas (fora do ar,
 * tempo esgotado, limite do CNPJ.ws) volta `falhou`, e quem cadastra
 * preenche à mão — a consulta nunca trava o cadastro.
 */
export async function consultarCnpj(cnpj: string): Promise<ConsultaDoCnpj> {
  const digitos = onlyDigits(cnpj);

  const brasilApi = await buscar(`https://brasilapi.com.br/api/cnpj/v1/${digitos}`);
  if (brasilApi?.status === 404) return { status: "nao_encontrado" };
  if (brasilApi?.ok) {
    const dados = objeto(await brasilApi.json().catch(() => null));
    if (dados) return { status: "ok", dados: dados as RespostaDoCnpj };
  }

  const cnpjWs = await buscar(`https://publica.cnpj.ws/cnpj/${digitos}`);
  if (cnpjWs?.status === 404) return { status: "nao_encontrado" };
  if (cnpjWs?.ok) {
    const dados = respostaDoCnpjWs(await cnpjWs.json().catch(() => null));
    if (dados) return { status: "ok", dados };
  }

  return { status: "falhou" };
}
