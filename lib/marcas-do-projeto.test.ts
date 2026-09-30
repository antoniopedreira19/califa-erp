/**
 * Testes da marca que o job leva — decisão 133.
 *
 * Rode com:  node --import tsx --test lib/marcas-do-projeto.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { marcaDoJob } from "./marcas-do-projeto";

// Decisão 133: uma marca → ela; mais de uma → a geral do cliente (PRD-01).

test("uma marca escolhida é a que o job leva", () => {
  assert.equal(marcaDoJob(["beats"], "ambev"), "beats");
});

test("a geral sozinha continua sendo ela", () => {
  assert.equal(marcaDoJob(["ambev"], "ambev"), "ambev");
});

test("mais de uma marca: o job leva a geral, mesmo fora das escolhidas", () => {
  assert.equal(marcaDoJob(["beats", "corona"], "ambev"), "ambev");
});

test("mais de uma marca com a geral entre elas: a geral", () => {
  assert.equal(marcaDoJob(["corona", "ambev", "beats"], "ambev"), "ambev");
});

test("mais de uma marca num cliente sem a geral: não há marca do job", () => {
  assert.equal(marcaDoJob(["beats", "corona"], null), null);
});

test("nenhuma marca: nada", () => {
  assert.equal(marcaDoJob([], "ambev"), null);
});
