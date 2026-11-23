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

const DATA_E_HORA = /(\d{2})\/(\d{2})\/(\d{4})\s+\d{2}:\d{2}/;
const DATA = /(\d{2})\/(\d{2})\/(\d{4})/;
const VALOR = /R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/;
const CNPJ = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/;

const paraIso = (m: RegExpMatchArray | null) => {
  if (!m) return null;
  const [, d, mes, a] = m;
  const iso = `${a}-${mes}-${d}`;
  return Number(mes) >= 1 && Number(mes) <= 12 && Number(d) >= 1 && Number(d) <= 31 ? iso : null;
};
const paraNumero = (v: string | undefined) => (v ? Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100) / 100 : null);

/** O trecho logo depois do rótulo (no máximo `n` caracteres). */
function depois(texto: string, rotulo: RegExp, n: number): string | null {
  const m = rotulo.exec(texto);
  return m ? texto.slice(m.index + m[0].length, m.index + m[0].length + n) : null;
}

function numeroPeloTexto(t: string): string | null {
  // DANFSe v2.0: o valor vem logo depois do rótulo, ou na linha de baixo.
  // O "Número da DPS" é outro número e nunca vale.
  const nfse = depois(t, /N[úu]mero da NFS-?e\b/i, 160);
  if (nfse) {
    const m = /^[\s:]*(?:Compet[êe]ncia da NFS-?e\s*)?(?:Data e Hora da Emiss[ãa]o da NFS-?e\s*)?(\d{1,15})\b/i.exec(nfse);
    if (m) return m[1];
  }
  // NFS-e municipais: "Número da Nota: 00000078".
  const nota = depois(t, /N[úu]mero da Nota\b/i, 60);
  if (nota) {
    const m = /^[\s:]*(\d{1,15})\b/.exec(nota);
    if (m) return m[1];
  }
  // DANFE: "Nº 63 SÉRIE 1" / "Nº 000.003.107 Série 1".
  const danfe = /N[º°o]\.?\s*(\d{1,3}(?:\.\d{3})+|\d{1,12})\s*\n?\s*S[ÉE]RIE/i.exec(t);
  if (danfe) return danfe[1];
  return null;
}

function emissaoPeloTexto(t: string): string | null {
  // Com hora: a emissão de NFS-e (a competência não tem hora).
  for (const rotulo of [/Data e Hora da Emiss[ãa]o da NFS-?e/i, /Data e Hora de Emiss[ãa]o/i]) {
    const trecho = depois(t, rotulo, 240);
    const iso = trecho ? paraIso(DATA_E_HORA.exec(trecho)) : null;
    if (iso) return iso;
  }
  // DANFE: "DATA DE EMISSÃO 13/10/2026" (sem hora).
  const danfe = depois(t, /DATA D[AE] EMISS[ÃA]O/i, 40);
  return danfe ? paraIso(DATA.exec(danfe)) : null;
}

function valorPeloTexto(t: string): number | null {
  const rotulos = [
    /VALOR TOTAL DA NOTA\s*=?/i,
    /VALOR TOTAL DO SERVI[ÇC]O\s*=?/i,
    /Valor da Opera[çc][ãa]o\s*\/\s*Servi[çc]o/i,
    /Valor do Servi[çc]o/i,
    /Valor dos Servi[çc]os/i,
  ];
  for (const rotulo of rotulos) {
    const trecho = depois(t, rotulo, 60);
    const m = trecho ? VALOR.exec(trecho) : null;
    const v = paraNumero(m?.[1]);
    if (v !== null && v > 0) return v;
  }
  return null;
}

function cnpjPeloTexto(t: string): string | null {
  // NFS-e: o primeiro CNPJ depois do PRESTADOR. DANFE: o primeiro antes do DESTINATÁRIO.
  const prestador = depois(t, /PRESTADOR/i, 500);
  const fonte = prestador ?? t.split(/DESTINAT[ÁA]RIO/i)[0];
  const m = fonte ? CNPJ.exec(fonte) : null;
  const digitos = m ? m[0].replace(/\D/g, "") : "";
  return digitos.length === 14 && isValidCnpj(digitos) ? digitos : null;
}

/** Número, emissão, valor e CNPJ do emitente pelo texto do PDF. Nulo no que não achou. */
export function lerPeloTexto(texto: string): CamposDoPdf {
  const t = normalizar(texto);
  return {
    numero: numeroPeloTexto(t),
    cnpj: cnpjPeloTexto(t),
    emissao: emissaoPeloTexto(t),
    valor: valorPeloTexto(t),
  };
}
