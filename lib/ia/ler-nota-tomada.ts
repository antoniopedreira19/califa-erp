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
import { isValidCnpj } from "@/lib/utils";
import { ESQUEMA_LEITURA_NOTA_TOMADA } from "./versao-nota-tomada";

export const VERSAO_LEITURA_NOTA_TOMADA = `${MODELO_LEITURA_NF}|${ESQUEMA_LEITURA_NOTA_TOMADA}`;

type Imposto = RetencaoDestacadaNaNf["imposto"];
const IMPOSTOS: Imposto[] = ["ISS", "IRRF", "PIS", "COFINS", "CSLL", "INSS"];

interface RetencaoBruta {
  aliquota: number | null;
  valor: number | null;
}

export interface DadosBrutosNotaTomada {
  numero_nf: string | null;
  cnpj_emissor: string | null;
  /** v3: "AAAA-MM-DD". Ausente nas leituras da v2. */
  data_emissao?: string | null;
  valor_total: number | null;
  descricao_servico: string | null;
  cnae: string | null;
  codigo_servico: string | null;
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
    "data_emissao",
    "valor_total",
    "descricao_servico",
    "cnae",
    "codigo_servico",
    "municipio_prestacao",
    "competencia",
    "codigo_verificacao",
    "retencoes",
    "confianca_baixa",
  ],
  properties: {
    numero_nf: { type: ["string", "null"] as const },
    cnpj_emissor: { type: ["string", "null"] as const, description: "O CNPJ de quem EMITIU a nota (o prestador), 14 dígitos, só números" },
    data_emissao: { type: ["string", "null"] as const, description: "A data de emissão da nota, AAAA-MM-DD" },
    valor_total: { type: ["number", "null"] as const, description: "O valor bruto da nota (dos serviços/produtos)" },
    descricao_servico: { type: ["string", "null"] as const, description: "Resumo em 1 linha do serviço/produto da NF" },
    cnae: {
      type: ["string", "null"] as const,
      description:
        "Só o código que a nota rotula como CNAE (7 dígitos, ex.: 7319-0/04). NÃO é o código de tributação nem o item da lista de serviços (ex.: 17.06.01), que vai em codigo_servico. Null se a nota não traz CNAE",
    },
    codigo_servico: {
      type: ["string", "null"] as const,
      description:
        "O código do serviço: o código de tributação nacional ou o item/subitem da lista de serviços da LC 116, como está escrito (ex.: 17.06.01 ou 17.06). Null se a nota não traz",
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
O CNAE (7 dígitos, ex. 7319-0/04) e o código do serviço (item da LC 116 ou código de tributação nacional, ex. 17.06.01) são campos diferentes: não preencha um com o outro.
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

/** O que a nota diverge do PDF. "emitente" só com o CNPJ lido válido. */
export type DivergenciaDoPdf = "numero" | "emitente" | "emissao" | "valor";

/** O que o PDF traz, como a IA leu. */
export interface OQueOPdfTraz {
  numero: string | null;
  cnpj: string | null;
  /** "AAAA-MM-DD". */
  emissao: string | null;
  valor: number | null;
}

/** O que se grava na nota (formato da RPC `gravar_leitura_da_nota`). */
export interface LeituraParaGravar {
  /** O PDF é desta nota (mesmo número e mesmo emitente): os dados abaixo valem. */
  arquivo_da_nota: boolean;
  pdf: OQueOPdfTraz;
  divergencias: DivergenciaDoPdf[];
  descricao_servico: string | null;
  /** Só no formato de CNAE, "NNNN-N/NN". */
  cnae: string | null;
  /** O código de tributação / item da LC 116, "NN.NN" ou "NN.NN.NN". */
  codigo_servico: string | null;
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
/** A mesma chave do banco (`chave_do_numero_da_nf`). */
export const chaveDoNumero = (s: string | null) =>
  (s ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/^0+/, "");
const dataValida = (s: string | null | undefined) =>
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s ?? "") && !Number.isNaN(Date.parse(String(s))) ? String(s) : null;

/** O CNAE só com 7 dígitos (a subclasse), no formato "NNNN-N/NN". */
export function cnaeLido(v: string | null): string | null {
  const t = (v ?? "").trim();
  // O item da LC 116 ("17.06.01") também tem dígitos e pontos: não é CNAE.
  if (!t || /^\d{1,2}\.\d{2}(\.\d{2})?(?![\d-])/.test(t)) return null;
  const d = soDigitos(t);
  return d.length === 7 ? `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5)}` : null;
}

/** O código do serviço (item da LC 116 / tributação nacional): "NN.NN" ou "NN.NN.NN". */
export function codigoServicoLido(v: string | null): string | null {
  // Seguido de hífen é CNAE escrito com pontos ("77.39-0-99"), não item da LC 116.
  const m = (v ?? "").match(/\b(\d{1,2})\.(\d{2})(?:\.(\d{2}))?(?![\d-])/);
  if (!m) return null;
  return [m[1].padStart(2, "0"), m[2], m[3]].filter(Boolean).join(".");
}

/**
 * Confere a leitura com o registro da nota e monta o que se grava. O PDF é
 * desta nota quando o número e o emitente batem; aí os dados da leitura
 * (descrição, CNAE, retenções…) valem. Emissão e valor diferentes não
 * recusam o arquivo: viram divergência para o financeiro corrigir o registro.
 * O CNPJ lido só conta se for válido — a IA às vezes troca um dígito.
 */
export function leituraParaGravar(
  dados: DadosBrutosNotaTomada,
  nota: { numero: string; cnpjEmitente: string | null; valor: number; emissao: string },
): { arquivoDaNota: boolean; motivo: string | null; leitura: LeituraParaGravar } {
  const cnpjLido = soDigitos(dados.cnpj_emissor);
  const pdf: OQueOPdfTraz = {
    numero: texto(dados.numero_nf, 60),
    cnpj: cnpjLido.length === 14 ? cnpjLido : null,
    emissao: dataValida(dados.data_emissao),
    valor: numero(dados.valor_total),
  };
  const divergencias: DivergenciaDoPdf[] = [];
  const chaveLida = chaveDoNumero(pdf.numero);
  const chaveDaNota = chaveDoNumero(nota.numero);
  if (chaveLida && chaveDaNota && chaveLida !== chaveDaNota) divergencias.push("numero");
  const cnpjDaNota = soDigitos(nota.cnpjEmitente);
  if (pdf.cnpj && isValidCnpj(pdf.cnpj) && cnpjDaNota.length === 14 && pdf.cnpj !== cnpjDaNota) divergencias.push("emitente");
  if (pdf.emissao && pdf.emissao !== nota.emissao) divergencias.push("emissao");
  if (pdf.valor !== null && Math.abs(pdf.valor - nota.valor) > 0.009) divergencias.push("valor");

  const arquivoDaNota = !divergencias.includes("numero") && !divergencias.includes("emitente");
  const motivo = divergencias.includes("numero")
    ? `O PDF traz a NF ${pdf.numero}, não a ${nota.numero}.`
    : divergencias.includes("emitente")
      ? "O PDF é de outro emitente."
      : null;

  const competencia = /^\d{4}-(0[1-9]|1[0-2])$/.test(dados.competencia ?? "") ? (dados.competencia as string) : null;
  const retencoes: RetencaoDestacadaNaNf[] = [];
  for (const imposto of IMPOSTOS) {
    const r = dados.retencoes?.[imposto.toLowerCase() as keyof DadosBrutosNotaTomada["retencoes"]];
    const valor = numero(r?.valor ?? null);
    if (valor == null) continue;
    const aliquota = typeof r?.aliquota === "number" && r.aliquota > 0 && r.aliquota < 100 ? Math.round(r.aliquota * 100) / 100 : null;
    retencoes.push({ imposto, aliquota, valor });
  }
  const valem = arquivoDaNota;
  return {
    arquivoDaNota,
    motivo,
    leitura: {
      arquivo_da_nota: arquivoDaNota,
      pdf,
      divergencias,
      descricao_servico: valem ? texto(dados.descricao_servico, 300) : null,
      cnae: valem ? cnaeLido(dados.cnae) : null,
      // A v1 mostrou a IA pondo o código do serviço no CNAE: aproveita de lá.
      codigo_servico: valem ? (codigoServicoLido(dados.codigo_servico) ?? codigoServicoLido(dados.cnae)) : null,
      municipio_prestacao: valem ? texto(dados.municipio_prestacao, 80) : null,
      competencia: valem ? competencia : null,
      codigo_verificacao: valem ? texto(dados.codigo_verificacao, 80) : null,
      retencoes: valem ? retencoes : [],
    },
  };
}
