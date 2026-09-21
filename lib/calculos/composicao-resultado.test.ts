/**
 * Testes do bloco "Composto por" em % do valor do job (21/09/2026).
 *
 * Rode com:  node --import tsx --test lib/calculos/composicao-resultado.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calcularResultadoOperacional,
  composicaoDoResultadoGeral,
} from "./versao-totais";

const umaCasa = (n: number) => Number(n.toFixed(1));

test("TES-0001/26-01 v3: 9,1% + 16,4% somam os 25,5% do Resultado geral", () => {
  const valorJob = 171229.03;
  const { resultadoOperacional, resultadoGeral } = calcularResultadoOperacional(
    valorJob,
    25629.03,
    102000,
  );
  const c = composicaoDoResultadoGeral({
    valorJob,
    honorarios: 15600,
    rentabilidade: 28000,
    resultadoOperacional,
  });
  assert.equal(c.honorariosPct, 9.1);
  assert.equal(c.rentabilidadePct, 16.4);
  assert.equal(
    umaCasa(c.honorariosPct! + c.rentabilidadePct!),
    umaCasa(resultadoGeral!),
  );
});

test("a soma bate mesmo quando arredondar as três separadamente daria 0,1 de diferença", () => {
  // 3,04% + 3,04% = 6,08%: separadas dariam 3,0 + 3,0 = 6,0 contra 6,1.
  const valorJob = 10000;
  const c = composicaoDoResultadoGeral({
    valorJob,
    honorarios: 304,
    rentabilidade: 304,
    resultadoOperacional: 608,
  });
  assert.equal(c.honorariosPct, 3.0);
  assert.equal(c.rentabilidadePct, 3.1);
  assert.equal(umaCasa(c.honorariosPct! + c.rentabilidadePct!), 6.1);
});

test("prejuízo: a rentabilidade negativa puxa a soma para o Resultado geral", () => {
  const c = composicaoDoResultadoGeral({
    valorJob: 100000,
    honorarios: 10000,
    rentabilidade: -15000,
    resultadoOperacional: -5000,
  });
  assert.equal(c.honorariosPct, 10);
  assert.equal(c.rentabilidadePct, -15);
});

test("parcelas que não fecham o resultado saem cada uma pelo próprio valor", () => {
  const c = composicaoDoResultadoGeral({
    valorJob: 100000,
    honorarios: 10000,
    rentabilidade: 20000,
    resultadoOperacional: 25000,
  });
  assert.equal(c.honorariosPct, 10);
  assert.equal(c.rentabilidadePct, 20);
});

test("sem planejado: honorários têm percentual, rentabilidade não", () => {
  const c = composicaoDoResultadoGeral({
    valorJob: 100000,
    honorarios: 12000,
    rentabilidade: 0,
    resultadoOperacional: null,
  });
  assert.equal(c.honorariosPct, 12);
  assert.equal(c.rentabilidadePct, null);
});

test("valor do job zerado: nenhum percentual", () => {
  const c = composicaoDoResultadoGeral({
    valorJob: 0,
    honorarios: 0,
    rentabilidade: 0,
    resultadoOperacional: null,
  });
  assert.deepEqual(c, { honorariosPct: null, rentabilidadePct: null });
});
