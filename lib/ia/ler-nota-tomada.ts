/**
 * A leitura ampliada da NF tomada (decisão 271, 23/11/2026).
 *
 * A leitura do anexo (decisões 152 e 192) traz número, emissão, valor, os
 * CNPJs e a descrição; a seção Notas Fiscais pede também o CNAE da própria
 * nota, o município da prestação (onde o ISS é devido), a competência, o
 * código de verificação (para conferir a nota no portal) e as retenções que
 * a nota destaca. É o mesmo pedido, com um esquema maior; o cache é o mesmo
 * `nf_extracao_cache`, com outra versão no `modelo`.
 *
 * Funções puras de validação ficam aqui também, testadas em
 * `ler-nota-tomada.test.ts`.
 */
import type OpenAI from "openai";
import { getOpenAIClient, MODELO_LEITURA_NF } from "./openai-client";
import type { RetencaoDestacadaNaNf } from "@/lib/types";

export const VERSAO_LEITURA_NOTA_TOMADA = `${MODELO_LEITURA_NF}|nota-tomada-v1`;

type Imposto = RetencaoDestacadaNaNf["imposto"];
const IMPOSTOS: Imposto[] = ["ISS", "IRRF", "PIS", "COFINS", "CSLL", "INSS"];

interface RetencaoBruta {
  aliquota: number | null;
  valor: number | null;
}

export interface DadosBrutosNotaTomada {
  numero_nf: string | null;
  cnpj_emissor: string | null;
  valor_total: number | null;
  descricao_servico: string | null;
  cnae: string | null;
  municipio_prestacao: string | null;
  competencia: string | null;
  codigo_verificacao: string | null;
  retencoes: Record<"iss" | "irrf" | "pis" | "cofins" | "csll" | "inss", RetencaoBruta>;
  confianca_baixa: boolean;
}

const RETENCAO = {
  type: "object" as const,
  additionalProperties: false,
  required: ["aliquota", "valor"],
  properties: {
    aliquota: { type: ["number", "null"] as const, description: "Em %, só se a nota mostrar" },
    valor: { type: ["number", "null"] as const, description: "Em reais; null se a nota não reteve" },
  },
};

export const SCHEMA_NOTA_TOMADA = {
  type: "object" as const,
  additionalProperties: false,
  required: [
    "numero_nf",
    "cnpj_emissor",
    "valor_total",
    "descricao_servico",
    "cnae",
    "municipio_prestacao",
    "competencia",
    "codigo_verificacao",
    "retencoes",
    "confianca_baixa",
  ],
  properties: {
    numero_nf: { type: ["string", "null"] as const },
    cnpj_emissor: { type: ["string", "null"] as const, description: "14 dígitos, só números" },
    valor_total: { type: ["number", "null"] as const, description: "O valor bruto da nota (dos serviços/produtos)" },
    descricao_servico: { type: ["string", "null"] as const, description: "Resumo em 1 linha do serviço/produto da NF" },
    cnae: {
      type: ["string", "null"] as const,
      description: "O CNAE que a nota informa, como está escrito (ex.: 7319-0/04). Null se a nota não traz CNAE",
    },
    municipio_prestacao: {
      type: ["string", "null"] as const,
      description: "Município/UF onde o serviço foi prestado ou onde o ISS é devido (ex.: São Paulo/SP)",
    },
    competencia: { type: ["string", "null"] as const, description: "Mês de competência, AAAA-MM. Null se a nota não informa" },
    codigo_verificacao: {
      type: ["string", "null"] as const,
      description: "O código de verificação da NFS-e ou a chave de acesso da NF-e, como está escrito",
    },
    retencoes: {
      type: "object" as const,
      additionalProperties: false,
      required: ["iss", "irrf", "pis", "cofins", "csll", "inss"],
      properties: { iss: RETENCAO, irrf: RETENCAO, pis: RETENCAO, cofins: RETENCAO, csll: RETENCAO, inss: RETENCAO },
      description: "Só os impostos que a nota diz que foram RETIDOS (descontados do valor a pagar). Imposto só informado, sem retenção, fica null",
    },
    confianca_baixa: {
      type: "boolean" as const,
      description: "true se o documento está borrado, incompleto ou se há dúvida relevante",
    },
  },
};

const PROMPT = `Você está lendo o PDF de uma Nota Fiscal brasileira (NFS-e ou DANFE) emitida CONTRA a empresa que paga o serviço.
Extraia os dados nos campos do schema. Use null quando não puder identificar com certeza — nunca invente, nunca chute.
Nas retenções, preencha só o que a nota mostra como RETIDO na fonte (ISS retido, IRRF, PIS, COFINS, CSLL, INSS). Imposto apenas destacado ou informado, sem retenção, fica com valor null.
Marque confianca_baixa=true se o documento estiver borrado, incompleto, cortado ou se houver qualquer dúvida relevante.`;

export async function lerNotaTomada(
  arquivo: Buffer,
  mimetype: string,
  cliente: OpenAI = getOpenAIClient(),
): Promise<{ dados: DadosBrutosNotaTomada; tokensIn: number; tokensOut: number }> {
  const b64 = arquivo.toString("base64");
  const imagem = mimetype.startsWith("image/");
  const resp = await cliente.responses.create({
    model: MODELO_LEITURA_NF,
    input: [
      {
        role: "user",
        content: [
          imagem
            ? { type: "input_image", image_url: `data:${mimetype};base64,${b64}` }
            : { type: "input_file", filename: "nf.pdf", file_data: `data:application/pdf;base64,${b64}` },
          { type: "input_text", text: PROMPT },
        ],
      },
    ],
    text: { format: { type: "json_schema", name: "nota_tomada", strict: true, schema: SCHEMA_NOTA_TOMADA } },
    max_output_tokens: 1200,
  } as never);
  const texto = (resp as { output_text?: string }).output_text ?? "";
  const usage = (resp as { usage?: { input_tokens: number; output_tokens: number } }).usage;
  const parsed = JSON.parse(texto) as Record<string, unknown>;
  for (const campo of SCHEMA_NOTA_TOMADA.required) {
    if (!(campo in parsed)) throw new Error(`Resposta da IA sem campo obrigatório: ${campo}`);
  }
  return { dados: parsed as unknown as DadosBrutosNotaTomada, tokensIn: usage?.input_tokens ?? 0, tokensOut: usage?.output_tokens ?? 0 };
}

/** O que se grava na nota (formato da RPC `gravar_leitura_da_nota`). */
export interface LeituraParaGravar {
  descricao_servico: string | null;
  cnae: string | null;
  municipio_prestacao: string | null;
  /** "AAAA-MM". */
  competencia: string | null;
  codigo_verificacao: string | null;
  retencoes: RetencaoDestacadaNaNf[];
}

const texto = (v: string | null, max: number) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};
const numero = (v: number | null) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);
const soDigitos = (s: string | null) => (s ?? "").replace(/\D/g, "");

/**
 * Confere a leitura com a nota do cadastro e monta o que se grava. Recusa
 * (devolve o motivo) quando o arquivo lido não parece ser esta nota: o
 * número ou o CNPJ do emitente diferentes do cadastro.
 */
export function leituraParaGravar(
  dados: DadosBrutosNotaTomada,
  nota: { numero: string; cnpjEmitente: string | null },
): { ok: true; leitura: LeituraParaGravar } | { ok: false; motivo: string } {
  const numeroLido = soDigitos(dados.numero_nf).replace(/^0+/, "");
  const numeroDaNota = soDigitos(nota.numero).replace(/^0+/, "");
  if (numeroLido && numeroDaNota && numeroLido !== numeroDaNota) {
    return { ok: false, motivo: `O arquivo traz a NF ${dados.numero_nf}, não a ${nota.numero}.` };
  }
  const cnpjLido = soDigitos(dados.cnpj_emissor);
  const cnpjDaNota = soDigitos(nota.cnpjEmitente);
  if (cnpjLido.length === 14 && cnpjDaNota.length === 14 && cnpjLido !== cnpjDaNota) {
    return { ok: false, motivo: "O arquivo é de outro emitente." };
  }
  const competencia = /^\d{4}-(0[1-9]|1[0-2])$/.test(dados.competencia ?? "") ? (dados.competencia as string) : null;
  const retencoes: RetencaoDestacadaNaNf[] = [];
  for (const imposto of IMPOSTOS) {
    const r = dados.retencoes?.[imposto.toLowerCase() as keyof DadosBrutosNotaTomada["retencoes"]];
    const valor = numero(r?.valor ?? null);
    if (valor == null) continue;
    const aliquota = typeof r?.aliquota === "number" && r.aliquota > 0 && r.aliquota < 100 ? Math.round(r.aliquota * 100) / 100 : null;
    retencoes.push({ imposto, aliquota, valor });
  }
  return {
    ok: true,
    leitura: {
      descricao_servico: texto(dados.descricao_servico, 300),
      cnae: texto(dados.cnae, 40),
      municipio_prestacao: texto(dados.municipio_prestacao, 80),
      competencia,
      codigo_verificacao: texto(dados.codigo_verificacao, 80),
      retencoes,
    },
  };
}
