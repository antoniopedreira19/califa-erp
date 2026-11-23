/**
 * A leitura da NF pelo TEXTO do PDF (decisão 271, leitura v4), complemento
 * da leitura por imagem (IA). Pedido do Tiago depois que a leitura por imagem
 * errou o ano em 3 notas e trocou dígitos de CNPJ em 8.
 *
 * Quando o PDF tem texto selecionável, número, emissão, valor e CNPJ do
 * emitente saem dos rótulos de cada layout, sem IA:
 *   - DANFSe v2.0 (NFS-e nacional): "Número da NFS-e" (nunca o "Número da
 *     DPS"), "Data e Hora da Emissão da NFS-e", "Valor da Operação /
 *     Serviço", o CNPJ do PRESTADOR;
 *   - NFS-e municipais (Salvador, São Paulo…): "Número da Nota", "Data e
 *     Hora de Emissão", "VALOR TOTAL DA NOTA" / "VALOR TOTAL DO SERVIÇO",
 *     o CNPJ do PRESTADOR DE SERVIÇOS;
 *   - DANFE (NF-e): "Nº … SÉRIE", "DATA DE EMISSÃO", "VALOR TOTAL DA NOTA",
 *     o primeiro CNPJ antes do DESTINATÁRIO.
 * O que não sai com segurança fica nulo: vale a leitura da imagem.
 *
 * Funções puras, testadas em `texto-da-nf.test.ts`; a extração do texto
 * (`pdf-parse`) fica no servidor (`extrairTextoDoPdf`).
 */
import { isValidCnpj } from "@/lib/utils";

/** O que o PDF traz: número, CNPJ do emitente, emissão "AAAA-MM-DD" e valor. */
export interface CamposDoPdf {
  numero: string | null;
  cnpj: string | null;
  emissao: string | null;
  valor: number | null;
}

/** Menos que isto de texto útil: o PDF é imagem (foto, escaneado). */
const MINIMO_DE_TEXTO = 80;

/** O texto do PDF, ou nulo se ele não tem texto selecionável. Só no servidor. */
export async function extrairTextoDoPdf(arquivo: Buffer): Promise<string | null> {
  // `require` em vez de `import`: o pdf-parse roda um teste ao ser importado
  // e quebra o build (mesmo padrão de rh/folhas/importar-actions.ts).
  const pdfParse = require("pdf-parse") as (b: Buffer) => Promise<{ text: string }>;
  try {
    const { text } = await pdfParse(arquivo);
    const limpo = normalizar(text ?? "");
    return limpo.replace(/\s/g, "").length >= MINIMO_DE_TEXTO ? limpo : null;
  } catch {
    return null;
  }
}

function normalizar(t: string): string {
  return t
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

// O pdf-parse cola as palavras dos rótulos ("NÚMERODANFS-e 28", "DATAE
// HORADAEMISSÃODANFS-e 19/10/202611:50:50"): os rótulos são procurados no
// texto compacto — sem espaços, sem acentos, em maiúsculas.
const compactar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, "");

const VALOR = "(\\d{1,3}(?:\\.\\d{3})*,\\d{2})";
const DATA = "(\\d{2})\\/(\\d{2})\\/(\\d{4})";
const CNPJ = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/;

const paraIso = (m: RegExpMatchArray | null) => {
  if (!m) return null;
  const [, d, mes, a] = m;
  return Number(mes) >= 1 && Number(mes) <= 12 && Number(d) >= 1 && Number(d) <= 31 ? `${a}-${mes}-${d}` : null;
};
const paraNumero = (v: string | undefined) => (v ? Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100) / 100 : null);

function numeroPeloTexto(c: string): string | null {
  const regras = [
    // DANFSe v2.0: "Número da NFS-e" — nunca o "Número da DPS".
    /NUMERODANFS-?E:?(\d{1,15})/,
    // NFS-e municipais: "Número da Nota: 00000078".
    /NUMERODANOTA:?(\d{1,15})/,
    // DANFE: "Nº 63 SÉRIE 1" / "Nº 000.003.107 Série 1".
    /N[º°O]\.?:?(\d{1,3}(?:\.\d{3})+|\d{1,12})SERIE/,
  ];
  for (const r of regras) {
    const m = r.exec(c);
    if (m) return m[1];
  }
  return null;
}

function emissaoPeloTexto(c: string): string | null {
  const regras = [
    new RegExp(`DATAEHORADAEMISSAODANFS-?E:?${DATA}`),
    new RegExp(`DATAEHORADEEMISSAO:?${DATA}`),
    new RegExp(`DATAD[AE]EMISSAO:?${DATA}`),
  ];
  for (const r of regras) {
    const iso = paraIso(r.exec(c));
    if (iso) return iso;
  }
  return null;
}

function valorPeloTexto(c: string): number | null {
  const regras = [
    new RegExp(`VALORTOTALDANOTA=?(?:R\\$)?${VALOR}`),
    new RegExp(`VALORTOTALDOSERVICO=?(?:R\\$)?${VALOR}`),
    new RegExp(`VALORDAOPERACAO\\/SERVICO(?:R\\$)?${VALOR}`),
    new RegExp(`VALORDOSSERVICOS:?(?:R\\$)?${VALOR}`),
    new RegExp(`VALORDOSERVICO:?(?:R\\$)?${VALOR}`),
  ];
  for (const r of regras) {
    const v = paraNumero(r.exec(c)?.[1]);
    if (v !== null && v > 0) return v;
  }
  return null;
}

function cnpjPeloTexto(c: string): string | null {
  // NFS-e: o primeiro CNPJ depois do PRESTADOR. DANFE: o primeiro antes do DESTINATÁRIO.
  const i = c.indexOf("PRESTADOR");
  const fonte = i >= 0 ? c.slice(i, i + 500) : c.split("DESTINATARIO")[0];
  const m = CNPJ.exec(fonte);
  const digitos = m ? m[0].replace(/\D/g, "") : "";
  return digitos.length === 14 && isValidCnpj(digitos) ? digitos : null;
}

/** Número, emissão, valor e CNPJ do emitente pelo texto do PDF. Nulo no que não achou. */
export function lerPeloTexto(texto: string): CamposDoPdf {
  const c = compactar(texto);
  return {
    numero: numeroPeloTexto(c),
    cnpj: cnpjPeloTexto(c),
    emissao: emissaoPeloTexto(c),
    valor: valorPeloTexto(c),
  };
}
