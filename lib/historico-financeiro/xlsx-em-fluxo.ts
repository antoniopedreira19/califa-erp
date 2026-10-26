/**
 * Leitura em fluxo de um .xlsx exportado pelo Google Sheets — a E1 da
 * importação do histórico financeiro (decisão 211).
 *
 * A planilha "Fin. Conta Califórnia" tem 45 MB compactados e quase 500 MB de
 * XML: carregar tudo em memória não cabe no Mac de 8 GB. Por isso o arquivo
 * é lido como zip (diretório central + inflate de cada entrada) e cada aba
 * é percorrida linha a linha. Não há dependência: o XML das abas é sempre o
 * mesmo formato regular, e as funções puras abaixo têm teste próprio.
 *
 * O que sai de cada célula é o valor que a planilha mostrava (o resultado em
 * cache das fórmulas), com uma única interpretação: número em formato de
 * data vira data ISO (`2026-03-05`). Erros de fórmula saem como texto
 * (`#REF!`) para a padronização decidir o que fazer.
 */
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createInflateRaw } from "node:zlib";
import { indiceDaColuna } from "./csv";

export type EntradaZip = {
  nome: string;
  metodo: number;
  tamanhoComprimido: number;
  tamanho: number;
  offsetLocal: number;
  /** Data e hora gravadas no zip, sem fuso (como o Google exportou). */
  modificadoEm: string;
};

export type AbaDoArquivo = {
  ordem: number;
  nome: string;
  oculta: boolean;
  entrada: string;
};

export type ContextoDasCelulas = {
  textos: string[];
  estiloEhData: boolean[];
};

export type LinhaBruta = {
  numero: number;
  /** Coluna (1 = A) → valor como a planilha mostrava. Só células com valor. */
  celulas: Map<number, string>;
  formulas: number;
};

const ASSINATURA_FIM = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

function dataDoDos(data: number, hora: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const ano = ((data >> 9) & 127) + 1980;
  return `${ano}-${p((data >> 5) & 15)}-${p(data & 31)} ${p(hora >> 11)}:${p((hora >> 5) & 63)}`;
}

/** Lê o diretório central do zip: nome, posição e tamanho de cada entrada. */
export async function lerDiretorioDoZip(caminho: string): Promise<Map<string, EntradaZip>> {
  const arquivo = await open(caminho, "r");
  try {
    const { size } = await arquivo.stat();
    const tamanhoFim = Math.min(size, 22 + 65535);
    const fim = Buffer.alloc(tamanhoFim);
    await arquivo.read(fim, 0, tamanhoFim, size - tamanhoFim);
    const i = fim.lastIndexOf(ASSINATURA_FIM);
    if (i < 0) throw new Error("O arquivo não é um .xlsx: não achei o diretório do zip.");
    const total = fim.readUInt16LE(i + 10);
    const tamanhoDiretorio = fim.readUInt32LE(i + 12);
    const inicioDiretorio = fim.readUInt32LE(i + 16);
    if (inicioDiretorio === 0xffffffff) throw new Error("Zip de 64 bits não é suportado.");
    const diretorio = Buffer.alloc(tamanhoDiretorio);
    await arquivo.read(diretorio, 0, tamanhoDiretorio, inicioDiretorio);
    const entradas = new Map<string, EntradaZip>();
    let p = 0;
    for (let k = 0; k < total; k++) {
      if (diretorio.readUInt32LE(p) !== 0x02014b50) throw new Error("Diretório do zip corrompido.");
      const tamanhoNome = diretorio.readUInt16LE(p + 28);
      const nome = diretorio.toString("utf8", p + 46, p + 46 + tamanhoNome);
      entradas.set(nome, {
        nome,
        metodo: diretorio.readUInt16LE(p + 10),
        tamanhoComprimido: diretorio.readUInt32LE(p + 20),
        tamanho: diretorio.readUInt32LE(p + 24),
        offsetLocal: diretorio.readUInt32LE(p + 42),
        modificadoEm: dataDoDos(diretorio.readUInt16LE(p + 14), diretorio.readUInt16LE(p + 12)),
      });
      p += 46 + tamanhoNome + diretorio.readUInt16LE(p + 30) + diretorio.readUInt16LE(p + 32);
    }
    return entradas;
  } finally {
    await arquivo.close();
  }
}

/** O conteúdo descompactado de uma entrada, em fluxo. */
export async function fluxoDaEntrada(caminho: string, entrada: EntradaZip): Promise<Readable> {
  if (entrada.tamanhoComprimido === 0) return Readable.from([]);
  const arquivo = await open(caminho, "r");
  const cabecalho = Buffer.alloc(30);
  try {
    await arquivo.read(cabecalho, 0, 30, entrada.offsetLocal);
  } finally {
    await arquivo.close();
  }
  if (cabecalho.readUInt32LE(0) !== 0x04034b50) throw new Error(`Entrada ${entrada.nome} corrompida.`);
  const inicio = entrada.offsetLocal + 30 + cabecalho.readUInt16LE(26) + cabecalho.readUInt16LE(28);
  const bruto = createReadStream(caminho, { start: inicio, end: inicio + entrada.tamanhoComprimido - 1 });
  if (entrada.metodo === 0) return bruto;
  if (entrada.metodo === 8) return bruto.pipe(createInflateRaw());
  throw new Error(`Compressão ${entrada.metodo} não suportada em ${entrada.nome}.`);
}

export async function textoDaEntrada(caminho: string, entrada: EntradaZip): Promise<string> {
  const decodificador = new StringDecoder("utf8");
  let texto = "";
  for await (const pedaco of await fluxoDaEntrada(caminho, entrada)) {
    texto += decodificador.write(pedaco as Buffer);
  }
  return texto + decodificador.end();
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodificarXml(texto: string): string {
  if (!texto.includes("&")) return texto;
  return texto.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, ent: string) => {
    if (ent.startsWith("#x")) return String.fromCodePoint(parseInt(ent.slice(2), 16));
    if (ent.startsWith("#")) return String.fromCodePoint(parseInt(ent.slice(1), 10));
    return ENTIDADES[ent];
  });
}

const REGEX_DO_ATRIBUTO = new Map<string, RegExp>();

function atributo(atributos: string, nome: string): string | null {
  let regex = REGEX_DO_ATRIBUTO.get(nome);
  if (!regex) {
    regex = new RegExp(`(?:^|\\s)${nome.replace(":", "\\:")}="([^"]*)"`);
    REGEX_DO_ATRIBUTO.set(nome, regex);
  }
  const m = regex.exec(atributos);
  return m ? decodificarXml(m[1]) : null;
}

/** As abas na ordem do arquivo, com o nome, se está oculta e a entrada do zip. */
export function abasDoWorkbook(workbookXml: string, relsXml: string): AbaDoArquivo[] {
  const alvos = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = atributo(m[1], "Id");
    const alvo = atributo(m[1], "Target");
    if (id && alvo) alvos.set(id, alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo}`);
  }
  const abas: AbaDoArquivo[] = [];
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const id = atributo(m[1], "r:id");
    const nome = atributo(m[1], "name");
    if (!id || nome === null || !alvos.has(id)) continue;
    const estado = atributo(m[1], "state");
    abas.push({ ordem: abas.length + 1, nome, oculta: estado === "hidden" || estado === "veryHidden", entrada: alvos.get(id)! });
  }
  return abas;
}

/** Os textos compartilhados, na ordem dos índices usados pelas células. */
export function textosCompartilhados(xml: string): string[] {
  const textos: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) {
    const corpo = (m[1] ?? "").replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
    let texto = "";
    for (const t of corpo.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) texto += t[1];
    textos.push(decodificarXml(texto));
  }
  return textos;
}

/**
 * Formato de número que mostra data ou hora: os embutidos 14–22 e 45–47, ou
 * um código com d, m, a, h ou s fora de aspas, colchetes e escapes — num
 * formato de número, letra solta só existe se for de data ("mmmm" mostra o
 * nome do mês de uma data).
 */
export function formatoEhData(numFmtId: number, codigo: string | undefined): boolean {
  if ((numFmtId >= 14 && numFmtId <= 22) || (numFmtId >= 45 && numFmtId <= 47)) return true;
  if (!codigo) return false;
  const limpo = codigo.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "").toLowerCase();
  return /[dmyhs]/.test(limpo);
}

/** Para cada estilo de célula (índice `s`), se ele mostra data. */
export function estilosDeData(stylesXml: string): boolean[] {
  const codigos = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
    const id = atributo(m[1], "numFmtId");
    const codigo = atributo(m[1], "formatCode");
    if (id !== null && codigo !== null) codigos.set(Number(id), codigo);
  }
  const bloco = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!bloco) return [];
  const resultado: boolean[] = [];
  for (const m of bloco[1].matchAll(/<xf\b([^>]*?)\/?>/g)) {
    const id = Number(atributo(m[1], "numFmtId") ?? 0);
    resultado.push(formatoEhData(id, codigos.get(id)));
  }
  return resultado;
}

const BASE_EXCEL = Date.UTC(1899, 11, 30);

/** Número de série do Excel → `AAAA-MM-DD` (ou `AAAA-MM-DD HH:MM:SS` quando tem hora). */
export function serialParaData(serial: number): string {
  const ms = Math.round(serial * 86400) * 1000;
  const iso = new Date(BASE_EXCEL + ms).toISOString();
  return Number.isInteger(serial) ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

function valorDaCelula(atributos: string, corpo: string, contexto: ContextoDasCelulas): string | null {
  const tipo = atributo(atributos, "t");
  if (tipo === "inlineStr") {
    let texto = "";
    for (const t of corpo.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) texto += t[1];
    return decodificarXml(texto);
  }
  const v = /<v>([\s\S]*?)<\/v>/.exec(corpo);
  if (!v) return null;
  const bruto = decodificarXml(v[1]);
  if (tipo === "s") return contexto.textos[Number(bruto)] ?? null;
  if (tipo === "b") return bruto === "1" ? "TRUE" : "FALSE";
  if (tipo === "e" || tipo === "str") return bruto;
  const estilo = Number(atributo(atributos, "s") ?? 0);
  if (contexto.estiloEhData[estilo]) {
    const n = Number(bruto);
    if (Number.isFinite(n) && n > 1 && n < 80000) return serialParaData(n);
  }
  return bruto;
}

/** Uma linha `<row>` do XML da aba → células com valor. */
export function celulasDaLinha(xmlDaLinha: string, contexto: ContextoDasCelulas): LinhaBruta {
  const numero = Number(/^<row\b[^>]*?\sr="(\d+)"/.exec(xmlDaLinha)?.[1] ?? 0);
  const celulas = new Map<number, string>();
  let formulas = 0;
  for (const m of xmlDaLinha.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const corpo = m[2] ?? "";
    if (corpo.includes("<f")) formulas++;
    const valor = valorDaCelula(m[1], corpo, contexto);
    if (valor === null || valor === "") continue;
    const ref = atributo(m[1], "r");
    const coluna = ref ? indiceDaColuna(ref) : celulas.size + 1;
    celulas.set(coluna, valor);
  }
  return { numero, celulas, formulas };
}

/** As linhas de uma aba, em fluxo, sem carregar o XML inteiro. */
export async function* linhasDaAba(
  caminho: string,
  entrada: EntradaZip,
  contexto: ContextoDasCelulas,
): AsyncGenerator<LinhaBruta> {
  const decodificador = new StringDecoder("utf8");
  let buffer = "";
  let acabou = false;
  for await (const pedaco of await fluxoDaEntrada(caminho, entrada)) {
    if (acabou) continue;
    buffer += decodificador.write(pedaco as Buffer);
    let pos = 0;
    while (true) {
      const fimDados = buffer.indexOf("</sheetData>", pos);
      let inicio = buffer.indexOf("<row", pos);
      while (inicio >= 0 && !/[\s>/]/.test(buffer[inicio + 4] ?? "")) inicio = buffer.indexOf("<row", inicio + 4);
      if (inicio < 0 || (fimDados >= 0 && fimDados < inicio)) {
        if (fimDados >= 0) acabou = true;
        pos = Math.max(pos, buffer.length - 16);
        break;
      }
      const fimAbertura = buffer.indexOf(">", inicio);
      if (fimAbertura < 0) {
        pos = inicio;
        break;
      }
      if (buffer[fimAbertura - 1] === "/") {
        pos = fimAbertura + 1;
        continue;
      }
      const fimLinha = buffer.indexOf("</row>", fimAbertura);
      if (fimLinha < 0) {
        pos = inicio;
        break;
      }
      yield celulasDaLinha(buffer.slice(inicio, fimLinha + 6), contexto);
      pos = fimLinha + 6;
    }
    buffer = buffer.slice(pos);
  }
}
