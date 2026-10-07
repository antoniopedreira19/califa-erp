/**
 * Testes do número sequencial do orçamento dentro do projeto.
 *
 * Rode com:  node --import tsx --test lib/codigos/orcamentos.test.ts
 *
 * Até 06/10/2026 o próximo número era a contagem + 1. Apagar orçamento no
 * meio da sequência (as cópias da AMB-P017/26) faria o próximo código
 * repetir um que ainda existe.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { proximaSequenciaOrcamento } from "./orcamentos";

const PROJETO = "AMB-P017/26";

test("projeto sem orçamento começa no 1", () => {
  assert.equal(proximaSequenciaOrcamento(PROJETO, []), 1);
});

test("sequência sem buraco segue a contagem", () => {
  assert.equal(
    proximaSequenciaOrcamento(PROJETO, ["AMB-P017/26-01", "AMB-P017/26-02"]),
    3,
  );
});

test("com buraco, vale o maior número, não a contagem", () => {
  // O que fica no AMB-P017/26 depois de apagar as cópias: 10 orçamentos,
  // o maior é o 46. A contagem daria 11, que é um dos que ficam.
  const restantes = ["01", "02", "04", "07", "11", "16", "22", "29", "37", "46"].map(
    (n) => `${PROJETO}-${n}`,
  );
  assert.equal(proximaSequenciaOrcamento(PROJETO, restantes), 47);
});

test("a ordem dos códigos não importa", () => {
  assert.equal(
    proximaSequenciaOrcamento(PROJETO, ["AMB-P017/26-09", "AMB-P017/26-03"]),
    10,
  );
});

test("código de orçamento excluído não volta (decisão 148)", () => {
  // O -03 foi excluído: ele só existe no registro de códigos usados, que o
  // gerador junta aos orçamentos de hoje. Sem ele, o próximo seria o -03.
  const deHoje = ["AMB-P017/26-01", "AMB-P017/26-02"];
  const registrados = ["AMB-P017/26-01", "AMB-P017/26-02", "AMB-P017/26-03"];
  assert.equal(
    proximaSequenciaOrcamento(PROJETO, [...new Set([...deHoje, ...registrados])]),
    4,
  );
});

test("passa do 99 sem quebrar", () => {
  assert.equal(proximaSequenciaOrcamento(PROJETO, ["AMB-P017/26-100"]), 101);
});

test("código fora do padrão do projeto conta só como piso", () => {
  assert.equal(
    proximaSequenciaOrcamento(PROJETO, ["AMB-0017/26-07", "AMB-P017/26-ABC"]),
    3,
  );
  // O prefixo é o código do projeto inteiro: "AMB-P017/2" não casa.
  assert.equal(
    proximaSequenciaOrcamento("AMB-P017/2", ["AMB-P017/26-05"]),
    2,
  );
});
