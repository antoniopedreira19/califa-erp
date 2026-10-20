import OpenAI from "openai";

/** O modelo escolhido pra leitura de NF (spec D3). Trocar aqui invalida o
 *  cache automaticamente: `nf_extracao_cache` guarda o modelo e o SELECT
 *  filtra por ele.
 *
 *  Troca em 8/10/2026: gpt-5-mini → gpt-4.1-mini. Motivo: gpt-5-mini é
 *  modelo de reasoning e adiciona 5–10s de latência "invisível" (chain of
 *  thought interno) pra tarefas que não precisam de raciocínio. gpt-4.1-mini
 *  é otimizado pra extração estruturada de documento, latência média
 *  1,5–3s, qualidade equivalente em DANFE padrão. */
export const MODELO_LEITURA_NF = "gpt-4.1-mini";

/** O custo estimado de uma leitura, em US$, para a auditoria. Preço de
 *  tabela do gpt-4.1-mini: US$ 0,40 por 1M de tokens de entrada e US$ 1,60
 *  por 1M de saída. Até a decisão 192 (19/10/2026) a conta usava o preço do
 *  gpt-5-mini (0,25 e 2), que ficou para trás na troca de 8/10. Leitura que
 *  sai do cache não gasta token: custo zero. */
export function custoEstimadoUsd(tokensIn: number, tokensOut: number): number {
  const usd = (tokensIn / 1_000_000) * 0.4 + (tokensOut / 1_000_000) * 1.6;
  return Number(usd.toFixed(6));
}

let clienteCached: OpenAI | null = null;

/** O cliente OpenAI, lazy. Lê `OPENAI_API_KEY` do ambiente só na primeira
 *  chamada. Falha explicitamente se a chave estiver faltando — melhor do
 *  que inicializar com undefined e explodir no primeiro request. */
export function getOpenAIClient(): OpenAI {
  if (clienteCached) return clienteCached;
  const chave = process.env.OPENAI_API_KEY;
  if (!chave) {
    throw new Error(
      "OPENAI_API_KEY não configurada. Adicione em .env.local (dev) e em Vercel " +
        "→ Settings → Environment Variables (Production + Preview).",
    );
  }
  clienteCached = new OpenAI({ apiKey: chave });
  return clienteCached;
}
