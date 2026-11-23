/**
 * Testes das regras puras das NFs presas ao job da planilha (decisão 276).
 *
 * Rode com:  node --import tsx --test lib/calculos/nfs-da-planilha.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { mesDaNotaMensal, mesDaNotaNoJob, nomeComparavel, sugestoesDoNome } from "./nfs-da-planilha";

test("compara o nome sem acento, caixa e espaços a mais", () => {
  assert.equal(nomeComparavel("  Cliente   Exemplo -  Ação 4T 2026 "), "cliente exemplo - acao 4t 2026");
  assert.equal(nomeComparavel("CLIENTE EXEMPLO - AÇÃO 4T 2026"), nomeComparavel("Cliente Exemplo - Ação 4T 2026"));
});

test("o mês da NF mensal é o anterior ao da emissão", () => {
  assert.equal(mesDaNotaMensal("2026-11-03"), "2026-10-01");
  assert.equal(mesDaNotaMensal("2026-10-09"), "2026-09-01");
  assert.equal(mesDaNotaMensal("2027-01-05"), "2026-12-01");
});

test("sugere pelos pedaços digitados, com o nome igual primeiro", () => {
  const jobs = [
    { nome: "Cliente Exemplo - Fee 4T 2026" },
    { nome: "Cliente Exemplo - Fee" },
    { nome: "Outro Cliente - Evento 4T 2026" },
  ];
  assert.deepEqual(
    sugestoesDoNome(jobs, "exemplo fee").map((j) => j.nome),
    ["Cliente Exemplo - Fee", "Cliente Exemplo - Fee 4T 2026"],
  );
  assert.equal(sugestoesDoNome(jobs, "cliente exemplo - fee")[0].nome, "Cliente Exemplo - Fee");
  assert.deepEqual(sugestoesDoNome(jobs, "x"), []);
});

test("o mês da NF no job: o anterior; se não é do job, o da emissão", () => {
  const quarto = ["2026-10-01", "2026-11-01", "2026-12-01"];
  assert.equal(mesDaNotaNoJob("2026-11-03", quarto), "2026-10-01");
  assert.equal(mesDaNotaNoJob("2026-10-09", quarto), "2026-10-01");
  assert.equal(mesDaNotaNoJob("2026-11-03", ["2026-07-01", "2026-08-01", "2026-09-01"]), null);
});
