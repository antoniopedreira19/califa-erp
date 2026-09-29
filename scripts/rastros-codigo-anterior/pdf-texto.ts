// Leitor de texto dos PDFs de PP. O documento é gerado pelo pdfmake com a
// Helvetica padrão (sem fonte embutida): o texto vai nos fluxos de conteúdo
// como cadeias hexadecimais em WinAnsi (cp1252), dentro de Tj/TJ. Basta
// descomprimir os fluxos e decodificar as cadeias, na ordem em que aparecem
// — que é a ordem em que o pdfmake desenha.
import { inflateSync } from "node:zlib";

// WinAnsi (cp1252) nas posições 0x80–0x9F; o resto coincide com Latin-1.
const CP1252: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
  0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘",
  0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜",
  0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

function decodificarHex(hex: string): string {
  const limpo = hex.replace(/\s+/g, "");
  let saida = "";
  for (let i = 0; i + 1 < limpo.length; i += 2) {
    const b = parseInt(limpo.slice(i, i + 2), 16);
    saida += CP1252[b] ?? String.fromCharCode(b);
  }
  return saida;
}

function decodificarLiteral(lit: string): string {
  // (texto) com escapes \( \) \\ e octais — o pdfkit usa hex, mas por via
  // das dúvidas.
  return lit
    .replace(/\\([0-7]{1,3})/g, (_m, o) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\(.)/g, "$1");
}

/** Fluxos descomprimidos que contêm operadores de texto. */
function fluxosDeConteudo(pdf: Buffer): string[] {
  const s = pdf.toString("latin1");
  const saida: string[] = [];
  let pos = 0;
  for (;;) {
    const ini = s.indexOf("stream", pos);
    if (ini < 0) break;
    let comeco = ini + "stream".length;
    if (s[comeco] === "\r") comeco++;
    if (s[comeco] === "\n") comeco++;
    const fim = s.indexOf("endstream", comeco);
    if (fim < 0) break;
    const bruto = pdf.subarray(comeco, fim);
    let texto: string | null = null;
    try {
      texto = inflateSync(bruto).toString("latin1");
    } catch {
      texto = bruto.toString("latin1");
    }
    if (texto && /\bBT\b/.test(texto) && /T[jJ]\b/.test(texto)) saida.push(texto);
    pos = fim + "endstream".length;
  }
  return saida;
}

/** Os pedaços de texto do documento, na ordem de desenho, página a página. */
export function textoDoPdf(pdf: Buffer): string[] {
  const pedacos: string[] = [];
  for (const fluxo of fluxosDeConteudo(pdf)) {
    // Arrays do TJ e cadeias soltas do Tj, na ordem.
    const re = /\[((?:<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\)|[-\d.\s])*)\]\s*TJ|<([0-9A-Fa-f\s]*)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fluxo))) {
      if (m[1] !== undefined) {
        let t = "";
        const partes = /<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\)/g;
        let p: RegExpExecArray | null;
        while ((p = partes.exec(m[1]))) {
          t += p[1] !== undefined ? decodificarHex(p[1]) : decodificarLiteral(p[2]);
        }
        pedacos.push(t);
      } else if (m[2] !== undefined) {
        pedacos.push(decodificarHex(m[2]));
      } else if (m[3] !== undefined) {
        pedacos.push(decodificarLiteral(m[3]));
      }
    }
  }
  return pedacos;
}

/** O valor que vem logo depois de um rótulo "Rótulo: " (pedaços separados
 *  pelo negrito do rótulo). */
export function valorDoRotulo(pedacos: string[], rotulo: string): string | null {
  const i = pedacos.findIndex((p) => p === `${rotulo}: `);
  return i >= 0 && i + 1 < pedacos.length ? pedacos[i + 1] : null;
}

/**
 * As linhas do documento. O pdfmake desenha palavra a palavra, cada uma com
 * a posição no `Tm`; palavras seguidas na mesma altura e andando para a
 * direita são a mesma linha de uma célula. Mudou a altura (ou voltou para a
 * esquerda), começa outra linha. A ordem é a de desenho, página a página.
 */
export function linhasDoPdf(pdf: Buffer): string[] {
  const linhas: string[] = [];
  for (const fluxo of fluxosDeConteudo(pdf)) {
    let atual = "";
    let yAtual: number | null = null;
    let xAnterior = -Infinity;
    const re = /1 0 0 1 ([-\d.]+) ([-\d.]+) Tm[\s\S]*?(\[(?:<[0-9A-Fa-f\s]*>|[-\d.\s])*\]\s*TJ|<[0-9A-Fa-f\s]*>\s*Tj)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fluxo))) {
      const x = Number(m[1]);
      const y = Number(m[2]);
      let t = "";
      const partes = /<([0-9A-Fa-f\s]*)>/g;
      let p: RegExpExecArray | null;
      while ((p = partes.exec(m[3]))) t += decodificarHex(p[1]);
      const mesmaLinha = yAtual !== null && Math.abs(y - yAtual) < 0.01 && x > xAnterior;
      if (!mesmaLinha) {
        if (atual.trim()) linhas.push(atual.trim());
        atual = "";
      }
      atual += t;
      yAtual = y;
      xAnterior = x;
    }
    if (atual.trim()) linhas.push(atual.trim());
  }
  return linhas;
}
