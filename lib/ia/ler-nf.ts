import type OpenAI from "openai";
import { getOpenAIClient, MODELO_LEITURA_NF } from "./openai-client";

export interface DadosBrutosNF {
  numero_nf: string | null;
  data_emissao: string | null;
  razao_social_emissor: string | null;
  cnpj_emissor: string | null;
  razao_social_tomador: string | null;
  cnpj_tomador: string | null;
  valor_total: number | null;
  descricao_servico: string | null;
  confianca_baixa: boolean;
}

/** O schema que o Structured Output da OpenAI força. `strict: true` garante
 *  conformance no decoder (não é só prompt). Spec D4. */
export const SCHEMA_DADOS_NF = {
  type: "object" as const,
  additionalProperties: false,
  required: [
    "numero_nf",
    "data_emissao",
    "razao_social_emissor",
    "cnpj_emissor",
    "razao_social_tomador",
    "cnpj_tomador",
    "valor_total",
    "descricao_servico",
    "confianca_baixa",
  ],
  properties: {
    numero_nf: { type: ["string", "null"] as const },
    data_emissao: {
      type: ["string", "null"] as const,
      description: "ISO YYYY-MM-DD, só se identificar com certeza",
    },
    razao_social_emissor: { type: ["string", "null"] as const },
    cnpj_emissor: {
      type: ["string", "null"] as const,
      description: "14 dígitos, só números, sem formatação",
    },
    razao_social_tomador: { type: ["string", "null"] as const },
    cnpj_tomador: {
      type: ["string", "null"] as const,
      description: "14 dígitos, só números, sem formatação",
    },
    valor_total: { type: ["number", "null"] as const },
    descricao_servico: {
      type: ["string", "null"] as const,
      description: "Resumo em 1 linha do serviço/produto da NF",
    },
    confianca_baixa: {
      type: "boolean" as const,
      description: "true se o documento está borrado, incompleto ou se há dúvida relevante",
    },
  },
};

const PROMPT = `Você está lendo o PDF de uma Nota Fiscal brasileira (DANFE ou NFSe).
Extraia os dados nos campos do schema. Use null quando não puder identificar com certeza — nunca invente, nunca chute.
CNPJ emissor é de quem EMITIU a NF (fornecedor). CNPJ tomador é de quem RECEBEU o serviço/produto (destinatário).
Marque confianca_baixa=true se o documento estiver borrado, incompleto, cortado ou se houver qualquer dúvida relevante.`;

/** Chama a Responses API com o PDF em base64 e retorna os dados brutos +
 *  contagem de tokens pra audit. Não valida: Task 6 valida depois.
 *
 *  O cliente é injetado pra permitir testar sem chave real; em produção,
 *  o default `getOpenAIClient()` carrega lazy da env. */
export async function lerDadosBrutosDaNF(
  pdfBuffer: Buffer,
  cliente: OpenAI = getOpenAIClient(),
): Promise<{ dados: DadosBrutosNF; tokensIn: number; tokensOut: number }> {
  const b64 = pdfBuffer.toString("base64");

  const resp = await cliente.responses.create({
    model: MODELO_LEITURA_NF,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename: "nf.pdf",
            file_data: `data:application/pdf;base64,${b64}`,
          },
          { type: "input_text", text: PROMPT },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "dados_nf",
        strict: true,
        schema: SCHEMA_DADOS_NF,
      },
    },
    max_output_tokens: 1024,
  } as never);

  const texto = (resp as { output_text?: string }).output_text ?? "";
  const usage = (resp as { usage?: { input_tokens: number; output_tokens: number } }).usage;
  const parsed = JSON.parse(texto) as unknown;
  const dados = garantirShapeDadosBrutosNF(parsed);

  return {
    dados,
    tokensIn: usage?.input_tokens ?? 0,
    tokensOut: usage?.output_tokens ?? 0,
  };
}

/** Shape check mínimo depois do JSON.parse. `strict: true` do Structured
 *  Output já garante no decoder, mas se o SDK mudar ou o modelo fizer
 *  fallback, chegamos aqui sem os campos — melhor explodir no servidor
 *  (action captura e audita) do que passar undefined pro frontend. */
function garantirShapeDadosBrutosNF(parsed: unknown): DadosBrutosNF {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Resposta da IA não é um objeto JSON válido.");
  }
  const obj = parsed as Record<string, unknown>;
  for (const campo of SCHEMA_DADOS_NF.required) {
    if (!(campo in obj)) {
      throw new Error(`Resposta da IA sem campo obrigatório: ${campo}`);
    }
  }
  if (typeof obj.confianca_baixa !== "boolean") {
    throw new Error("Resposta da IA com confianca_baixa inválida (esperado boolean).");
  }
  return obj as unknown as DadosBrutosNF;
}

// ---------------------------------------------------------------------------
// Leitura do documento ao anexar (decisão 192, 19/10/2026): o
// mesmo pedido da NF, mais o tipo do documento e o número dele. Vale para
// NF, recibo, fatura, boleto, guia, contrato e outros. A guia (taxa,
// licença ou alvará de órgão público) entrou na decisão 227 (29/10/2026).
// ---------------------------------------------------------------------------

export const TIPOS_LIDOS = ["nota_fiscal", "recibo", "fatura", "boleto", "guia", "contrato", "outro"] as const;

export interface DadosBrutosDocumento extends DadosBrutosNF {
  tipo_documento: (typeof TIPOS_LIDOS)[number] | null;
  numero_documento: string | null;
}

/** O cache da leitura do documento não se mistura com o da NF: a mesma
 *  coluna `modelo` leva a versão do pedido. */
export const VERSAO_LEITURA_DOCUMENTO = `${MODELO_LEITURA_NF}|documento-v1`;

export const SCHEMA_DADOS_DOCUMENTO = {
  ...SCHEMA_DADOS_NF,
  required: [...SCHEMA_DADOS_NF.required, "tipo_documento", "numero_documento"],
  properties: {
    ...SCHEMA_DADOS_NF.properties,
    tipo_documento: {
      type: ["string", "null"] as const,
      enum: [...TIPOS_LIDOS, null],
      description:
        "nota_fiscal (DANFE, NFS-e), recibo, fatura (inclusive fatura de locação), boleto, guia (taxa, licença ou alvará de órgão público), contrato ou outro",
    },
    numero_documento: {
      type: ["string", "null"] as const,
      description: "O número que identifica o documento (Fatura nº, Recibo nº, número da NF, número do documento do boleto, número da guia)",
    },
  },
};

const PROMPT_DOCUMENTO = `Você está lendo um documento anexado a um pedido de compra de uma agência no Brasil.
Primeiro diga que documento é: nota_fiscal (DANFE ou NFS-e), recibo, fatura (inclusive fatura de locação), boleto, guia, contrato ou outro.
guia é o documento de arrecadação de um órgão público (prefeitura, estado, União) para pagar taxa, licença ou alvará — por exemplo DAM, DAR, DARE ou GRU; o código de barras dela começa com 8. Boleto de cobrança de uma empresa é boleto, não guia.
Depois extraia os dados nos campos do schema. numero_documento é o número que identifica o documento; numa NF, é o mesmo número da nota.
Os campos de NF (data de emissão, valor total, CNPJs) valem para qualquer documento que os traga. CNPJ emissor é de quem emitiu; CNPJ tomador é de quem recebe ou paga (o cliente, o sacado).
Use null quando não puder identificar com certeza — nunca invente, nunca chute.
Marque confianca_baixa=true se o documento estiver borrado, incompleto, cortado ou se houver qualquer dúvida relevante, inclusive sobre o tipo.`;

export async function lerDadosBrutosDoDocumento(
  pdfBuffer: Buffer,
  cliente: OpenAI = getOpenAIClient(),
): Promise<{ dados: DadosBrutosDocumento; tokensIn: number; tokensOut: number }> {
  const resp = await cliente.responses.create({
    model: MODELO_LEITURA_NF,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename: "documento.pdf",
            file_data: `data:application/pdf;base64,${pdfBuffer.toString("base64")}`,
          },
          { type: "input_text", text: PROMPT_DOCUMENTO },
        ],
      },
    ],
    text: {
      format: { type: "json_schema", name: "dados_documento", strict: true, schema: SCHEMA_DADOS_DOCUMENTO },
    },
    max_output_tokens: 1024,
  } as never);

  const texto = (resp as { output_text?: string }).output_text ?? "";
  const usage = (resp as { usage?: { input_tokens: number; output_tokens: number } }).usage;
  const obj = JSON.parse(texto) as Record<string, unknown>;
  const nf = garantirShapeDadosBrutosNF(obj);
  const tipo = obj.tipo_documento;
  return {
    dados: {
      ...nf,
      tipo_documento: (TIPOS_LIDOS as readonly unknown[]).includes(tipo)
        ? (tipo as DadosBrutosDocumento["tipo_documento"])
        : null,
      numero_documento: typeof obj.numero_documento === "string" ? obj.numero_documento : null,
    },
    tokensIn: usage?.input_tokens ?? 0,
    tokensOut: usage?.output_tokens ?? 0,
  };
}
