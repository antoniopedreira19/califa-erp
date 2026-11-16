/**
 * Testes do rateio de regional — mesma regra da vw_fluxo_caixa
 * (migration 20261115950001, Tiago em 15/11/2026).
 *
 * Rode com:  node --import tsx --test lib/calculos/rateio-regional.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { valoresDoRateio } from "./rateio-regional";

const soma = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x * 100, 0)) / 100;

test("AV-00026: o centavo fica com a SP, a de maior percentual", () => {
  // Ordem em que o banco devolve as linhas hoje: SP, NE, RJ, NO.
  const partes = [
    { percentual: 30, nome: "SP" },
    { percentual: 25, nome: "NE" },
    { percentual: 25, nome: "RJ" },
    { percentual: 20, nome: "NO" },
  ];
  const valores = valoresDoRateio(partes, 4069.86);
  assert.deepEqual(valores, [1220.95, 1017.47, 1017.47, 813.97]);
  assert.equal(soma(valores), 4069.86);
});

test("a ordem das linhas não muda quem leva o centavo", () => {
  const partes = [
    { percentual: 20, nome: "NO" },
    { percentual: 25, nome: "RJ" },
    { percentual: 30, nome: "SP" },
    { percentual: 25, nome: "NE" },
  ];
  assert.deepEqual(valoresDoRateio(partes, 4069.86), [813.97, 1017.47, 1220.95, 1017.47]);
});

test("o centavo que falta também vai para a de maior percentual", () => {
  // 33,33% de 100,01 = 33,333 → 33,33; 33,34% = 33,343 → 33,34.
  // Soma 100,00: falta 0,01, que vai para a RJ (33,34%).
  const partes = [
    { percentual: 33.33, nome: "SP" },
    { percentual: 33.33, nome: "NE" },
    { percentual: 33.34, nome: "RJ" },
  ];
  const valores = valoresDoRateio(partes, 100.01);
  assert.deepEqual(valores, [33.33, 33.33, 33.35]);
  assert.equal(soma(valores), 100.01);
});

test("empate no maior percentual: a primeira em ordem alfabética", () => {
  const empatadas = [
    { percentual: 50, nome: "SP" },
    { percentual: 50, nome: "NE" },
  ];
  // 0,03 / 2 = 0,015 → 0,02 + 0,02; a NE devolve o centavo.
  assert.deepEqual(valoresDoRateio(empatadas, 0.03), [0.02, 0.01]);
});

test("rateio que já fecha não muda", () => {
  const partes = [
    { percentual: 60, nome: "SP" },
    { percentual: 40, nome: "RJ" },
  ];
  assert.deepEqual(valoresDoRateio(partes, 1000), [600, 400]);
});

test("uma regional só leva o valor inteiro", () => {
  assert.deepEqual(valoresDoRateio([{ percentual: 100, nome: "SP" }], 123.45), [123.45]);
});
