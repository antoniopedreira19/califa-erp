/**
 * A leitura da NF pelo TEXTO do PDF (decisão 271, leitura v4), complemento
 * da leitura por imagem (IA). Pedido do Tiago depois que a leitura por imagem
 * errou o ano em 3 notas e trocou dígitos de CNPJ em 8.
 *
 * Quando o PDF tem texto selecionável, número, emissão, valor e CNPJ do
 * emitente saem do próprio documento, sem IA:
 *   - a CHAVE DE ACESSO (44 dígitos na NF-e, 50 na NFS-e nacional, que também
 *     aparece como "Identificador Nacional" nas NFS-e municipais), conferida
 *     pelo dígito verificador: traz o número e o CNPJ do emitente;
 *   - os RÓTULOS de cada layout: DANFSe v2.0 ("Número da NFS-e", nunca o da
 *     DPS; "Data e Hora da Emissão da NFS-e"; "Valor da Operação / Serviço"),
 *     NFS-e de São Paulo (rótulos numa linha, valores na seguinte), NFS-e
 *     municipais ("Número da Nota", "Data de Emissão", "Valor Total"), DANFE
 *     ("Nº … Série", o canhoto "EMISSÃO: … VALOR TOTAL: R$ …").
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
    const limpo = normalizarTextoDoPdf(text ?? "");
    return limpo.replace(/\s/g, "").length >= MINIMO_DE_TEXTO ? limpo : null;
  } catch {
    return null;
  }
}

/**
 * O texto como vai para o banco: sem os caracteres de controle (o "\u0000"
 * de alguns PDFs derruba a gravação: o jsonb não aceita) e com os espaços
 * de cada linha reduzidos a um.
 */
export function normalizarTextoDoPdf(t: string): string {
  return t
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

// ---------------------------------------------------------------------------
// A chave de acesso
// ---------------------------------------------------------------------------

/** Dígito verificador da chave (NF-e e NFS-e nacional): módulo 11, pesos 2 a 9. */
function digitoDaChave(corpo: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = corpo.length - 1; i >= 0; i--) {
    soma += Number(corpo[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

const ufValida = (uf: string) => Number(uf) >= 11 && Number(uf) <= 53;
const mesValido = (mm: string) => Number(mm) >= 1 && Number(mm) <= 12;
const semZerosAEsquerda = (n: string) => n.replace(/^0+(?=\d)/, "");

/**
 * NF-e / NFC-e (44): UF(2) AAMM(4) CNPJ(14) modelo(2) série(3) número(9)
 * tipo de emissão(1) código(8) DV(1).
 */
function chaveDaNfe(s: string): { numero: string; cnpj: string | null } | null {
  if (!ufValida(s.slice(0, 2)) || !mesValido(s.slice(4, 6))) return null;
  if (!["55", "65"].includes(s.slice(20, 22))) return null;
  if (digitoDaChave(s.slice(0, 43)) !== Number(s[43])) return null;
  const cnpj = s.slice(6, 20);
  return { numero: semZerosAEsquerda(s.slice(25, 34)), cnpj: isValidCnpj(cnpj) ? cnpj : null };
}

/**
 * NFS-e nacional (50): município(7) ambiente(1) tipo de inscrição(1, 2 = CNPJ)
 * inscrição(14) número(13) AAMM(4) código(9) DV(1). Alguns municípios numeram
 * com o ano na frente ("2026000000135" é a nota 135): o ano sai.
 */
function chaveDaNfse(s: string): { numero: string; cnpj: string | null } | null {
  if (!ufValida(s.slice(0, 2)) || !["1", "2"].includes(s[7]) || !["1", "2"].includes(s[8])) return null;
  if (!mesValido(s.slice(38, 40))) return null;
  if (digitoDaChave(s.slice(0, 49)) !== Number(s[49])) return null;
  const cnpj = s[8] === "2" && isValidCnpj(s.slice(9, 23)) ? s.slice(9, 23) : null;
  let numero = s.slice(23, 36);
  const ano = `20${s.slice(36, 38)}`;
  if (numero.startsWith(ano) && /[1-9]/.test(numero.slice(4))) numero = numero.slice(4);
  return { numero: semZerosAEsquerda(numero), cnpj };
}

/**
 * A chave de acesso do documento, conferida pelo dígito verificador. Linha a
 * linha e sem os espaços: a chave vem em grupos de 4 ("3526 1135 …"), e
 * juntar as linhas colaria a chave no número do protocolo.
 */
export function chaveDeAcesso(texto: string): { numero: string; cnpj: string | null } | null {
  for (const linha of texto.split("\n")) {
    for (const [sequencia] of linha.replace(/[ \t.]/g, "").matchAll(/\d{44,}/g)) {
      for (let i = 0; i + 44 <= sequencia.length; i++) {
        const nfse = i + 50 <= sequencia.length ? chaveDaNfse(sequencia.slice(i, i + 50)) : null;
        if (nfse) return nfse;
        const nfe = chaveDaNfe(sequencia.slice(i, i + 44));
        if (nfe) return nfe;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Os rótulos
// ---------------------------------------------------------------------------

// O pdf-parse cola as palavras dos rótulos ("NÚMERODANFS-e 28", "DATAE
// HORADAEMISSÃODANFS-e 19/10/202611:50:50"): os rótulos são procurados no
// texto compacto — sem espaços, sem acentos, em maiúsculas.
const compactar = (t: string) =>
  t
    .replace(/[­‐-―−]/g, "-")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, "");

const VALOR = "(\\d{1,3}(?:\\.\\d{3})*,\\d{2})";
const DATA = "(\\d{2})[\\/-](\\d{2})[\\/-](\\d{4})";
const CNPJ_FORMATADO = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g;

const paraIso = (d: string | undefined, mes: string | undefined, a: string | undefined) => {
  if (!d || !mes || !a) return null;
  const ok = mesValido(mes) && Number(d) >= 1 && Number(d) <= 31 && Number(a) >= 2000 && Number(a) <= 2099;
  return ok ? `${a}-${mes}-${d}` : null;
};
const paraNumero = (v: string | undefined) => (v ? Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100) / 100 : null);

interface PeloRotulo {
  numero: string | null;
  emissao: string | null;
}

/** Os layouts em que número e emissão vêm juntos, rótulos numa linha e valores na seguinte. */
function numeroEEmissaoJuntos(c: string): PeloRotulo | null {
  // DANFSe com os rótulos juntos: "…NFS-e 64 01/10/2026 28/10/2026 15:37:16"
  // (número, competência, emissão).
  const danfse = new RegExp(`NUMERODANFS-?ECOMPETENCIADANFS-?EDATAEHORADAEMISSAODANFS-?E(\\d{1,15})${DATA}${DATA}`).exec(c);
  if (danfse) return { numero: danfse[1], emissao: paraIso(danfse[5], danfse[6], danfse[7]) };
  // NFS-e de São Paulo: o número (8 dígitos) colado na data e hora da emissão.
  // Antes deles pode vir o RPS ("RPS Nº 14 Série 11"), que não é o número da nota.
  const sp = new RegExp(`NUMERODANOTADATAEHORADEEMISSAOCODIGODEVERIFICACAO.{0,200}?(\\d{8})${DATA}`).exec(c);
  if (sp) return { numero: sp[1], emissao: paraIso(sp[2], sp[3], sp[4]) };
  return null;
}

function numeroPeloRotulo(c: string): string | null {
  const regras = [
    // DANFSe v2.0: "Número da NFS-e" — nunca o "Número da DPS".
    /NUMERODANFS-?E:?(\d{1,15})(?![\d/-])/,
    // NFS-e municipais: "Número da Nota: 00000078".
    /NUMERODANOTA:?(\d{1,15})(?![\d/-])/,
  ];
  for (const r of regras) {
    const m = r.exec(c);
    if (m) return m[1];
  }
  // DANFE: "Nº 63 SÉRIE 1" / "Nº. 000.003.107 Série 1". Só na DANFE: a NFS-e
  // de São Paulo traz "RPS Nº 14 Série 11", que não é o número da nota.
  if (c.includes("DANFE")) {
    const m = /N[º°O]\.?:?(\d{1,3}(?:\.\d{3})+|\d{1,12})SERIE/.exec(c);
    if (m) return m[1];
  }
  return null;
}

function emissaoPeloRotulo(c: string): string | null {
  const danfe = c.includes("DANFE");
  const regras = [
    new RegExp(`DATAEHORADAEMISSAODANFS-?E:?${DATA}`),
    // O canhoto da DANFE: "EMISSÃO: 16/11/2026 … VALOR TOTAL: R$ …". Só na
    // DANFE: na NFS-e, "emissão:" pode estar na discriminação do serviço.
    ...(danfe ? [new RegExp(`EMISSAO:${DATA}`)] : []),
    new RegExp(`DATAEHORADEEMISSAO:?${DATA}`),
    new RegExp(`DATAD[AE]EMISSAO(?:DANOTA)?:?${DATA}`),
    new RegExp(`EMISSAO\\(HORARIODEBRASILIA\\)${DATA}`),
  ];
  for (const r of regras) {
    const m = r.exec(c);
    const iso = m ? paraIso(m[1], m[2], m[3]) : null;
    if (iso) return iso;
  }
  // DANFE sem canhoto: os rótulos numa linha ("NOME/RAZÃO SOCIAL CNPJ/CPF
  // DATA DA EMISSÃO") e os valores na seguinte.
  if (danfe) {
    const m = new RegExp(`DATAD[AE]EMISSAO.{0,150}?${DATA}`).exec(c);
    const iso = m ? paraIso(m[1], m[2], m[3]) : null;
    if (iso) return iso;
  }
  return null;
}

function valorPeloRotulo(c: string): number | null {
  if (c.includes("DANFE")) {
    // O canhoto da DANFE: "VALOR TOTAL: R$ 19.270,00". Só na DANFE: na NFS-e,
    // a discriminação do serviço traz o "Valor total: R$" de cada item.
    const canhoto = paraNumero(new RegExp(`VALORTOTAL:R\\$${VALOR}`).exec(c)?.[1]);
    if (canhoto) return canhoto;
    // DANFE: "VALOR TOTAL DA NOTA" é o último rótulo da linha do cálculo do
    // imposto; os valores da linha (frete, seguro, desconto…) vêm colados
    // depois dele, e o total é o último.
    const m = /VALORTOTALDANOTA((?:\d{1,3}(?:\.\d{3})*,\d{2})+)/.exec(c);
    const v = paraNumero(m?.[1].match(/\d{1,3}(?:\.\d{3})*,\d{2}/g)?.at(-1));
    return v || null;
  }
  const regras = [
    new RegExp(`VALORTOTALDANOTA=?(?:R\\$)?${VALOR}`),
    new RegExp(`VALORTOTALDOSERVICO=?(?:R\\$)?${VALOR}`),
    new RegExp(`VALORDAOPERACAO\\/SERVICO(?:R\\$)?${VALOR}`),
    new RegExp(`VALORDOSSERVICOS:?(?:R\\$)?${VALOR}`),
    new RegExp(`VALORDOSERVICO:?(?:R\\$)?${VALOR}`),
  ];
  for (const r of regras) {
    const v = paraNumero(r.exec(c)?.[1]);
    if (v) return v;
  }
  return null;
}

/**
 * O CNPJ do prestador pelos rótulos (quando não há chave de acesso): o
 * primeiro CNPJ depois de "PRESTADOR", antes do "TOMADOR", que não seja de
 * uma empresa do grupo (o tomador às vezes vem antes no texto do PDF).
 */
function cnpjPeloRotulo(c: string, proprios: ReadonlySet<string>): string | null {
  for (let i = c.indexOf("PRESTADOR"); i >= 0; i = c.indexOf("PRESTADOR", i + 1)) {
    const resto = c.slice(i, i + 600);
    const fim = resto.indexOf("TOMADOR");
    const bloco = fim > 0 ? resto.slice(0, fim) : resto;
    for (const [formatado] of bloco.matchAll(CNPJ_FORMATADO)) {
      const digitos = formatado.replace(/\D/g, "");
      if (!proprios.has(digitos) && isValidCnpj(digitos)) return digitos;
    }
  }
  return null;
}

/**
 * Número, emissão, valor e CNPJ do emitente pelo texto do PDF. Nulo no que
 * não achou. `proprios`: os CNPJs das empresas do grupo (os tomadores), que
 * nunca são o emitente pelos rótulos.
 */
export function lerPeloTexto(texto: string, proprios: ReadonlySet<string> = new Set()): CamposDoPdf {
  const c = compactar(texto);
  const chave = chaveDeAcesso(texto);
  const juntos = numeroEEmissaoJuntos(c);
  return {
    numero: juntos?.numero ?? numeroPeloRotulo(c) ?? chave?.numero ?? null,
    cnpj: chave?.cnpj ?? cnpjPeloRotulo(c, proprios),
    emissao: juntos?.emissao ?? emissaoPeloRotulo(c),
    valor: valorPeloRotulo(c),
  };
}
