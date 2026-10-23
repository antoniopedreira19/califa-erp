#!/usr/bin/env node
/**
 * Regrava `lib/data/municipios-ibge.json` a partir da API pública do IBGE.
 *
 * A busca de cidade lê a lista do arquivo, não da API: desde ~16/10/2026 o
 * IBGE não atende a Vercel, e cada busca esperava 10 s pela conexão. A
 * lista muda muito pouco (o último município novo foi instalado em 2025),
 * então basta rodar este script quando o IBGE anunciar município novo:
 *
 *   node scripts/atualizar-municipios-ibge.mjs
 *
 * Formato: um município por linha, `[codigo, nome, uf]`, em ordem
 * alfabética — o diff do commit mostra exatamente o que entrou ou mudou.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const URL_IBGE = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios";
const DESTINO = fileURLToPath(new URL("../lib/data/municipios-ibge.json", import.meta.url));

const res = await fetch(URL_IBGE, { signal: AbortSignal.timeout(60_000) });
if (!res.ok) throw new Error(`IBGE ${res.status}: ${res.statusText}`);
const brutos = await res.json();

const municipios = brutos.map((m) => {
  // Município recém-criado pode vir sem microrregião; a região imediata
  // (divisão de 2017) traz a UF do mesmo jeito.
  const uf =
    m.microrregiao?.mesorregiao?.UF?.sigla ??
    m["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla;
  if (!uf) throw new Error(`Município sem UF: ${m.id} ${m.nome}`);
  return [String(m.id), m.nome, uf];
});
municipios.sort((a, b) => a[1].localeCompare(b[1], "pt-BR") || a[2].localeCompare(b[2]));

const linhas = municipios.map((m) => JSON.stringify(m));
writeFileSync(DESTINO, `[\n${linhas.join(",\n")}\n]\n`);
console.log(`${municipios.length} municípios gravados em ${DESTINO}`);
