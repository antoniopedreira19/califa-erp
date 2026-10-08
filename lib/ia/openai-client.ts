import OpenAI from "openai";

/** O modelo escolhido pra leitura de NF (spec D3). Trocar aqui invalida o
 *  cache automaticamente: `nf_extracao_cache` guarda o modelo e o SELECT
 *  filtra por ele. */
export const MODELO_LEITURA_NF = "gpt-5-mini";

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
