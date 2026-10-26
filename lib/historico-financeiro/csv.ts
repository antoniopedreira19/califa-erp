/**
 * CSV do histórico financeiro (E1 e E2 da importação da planilha
 * "Fin. Conta Califórnia", decisão 211): vírgula como separador, aspas só
 * quando o campo pede (vírgula, aspas ou quebra de linha) e UTF-8 com BOM,
 * para o Excel abrir os acentos sem perguntar.
 *
 * Sem dependência: o leitor segue a RFC 4180 e aceita o BOM no começo.
 */

export const BOM = "﻿";

export function campoCsv(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  const texto = String(valor);
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function linhaCsv(campos: ReadonlyArray<string | number | null | undefined>): string {
  return campos.map(campoCsv).join(",") + "\n";
}

/** Lê o texto inteiro de um CSV em linhas de campos. */
export function lerCsv(texto: string): string[][] {
  if (texto.startsWith(BOM)) texto = texto.slice(1);
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let entreAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (entreAspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreAspas = false;
        }
      } else {
        campo += ch;
      }
      continue;
    }
    if (ch === '"') {
      entreAspas = true;
    } else if (ch === ",") {
      linha.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else {
      campo += ch;
    }
  }
  if (campo !== "" || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

/** "A" → 1, "Z" → 26, "AA" → 27. */
export function indiceDaColuna(letras: string): number {
  let n = 0;
  for (const ch of letras.toUpperCase()) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n;
}

/** 1 → "A", 27 → "AA". */
export function letrasDaColuna(indice: number): string {
  let letras = "";
  let n = indice;
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras;
}
