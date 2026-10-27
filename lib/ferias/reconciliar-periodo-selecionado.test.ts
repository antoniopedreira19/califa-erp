import { test } from "node:test";
import assert from "node:assert/strict";
import { reconciliarPeriodoSelecionado } from "./reconciliar-periodo-selecionado";

test("mantém o atual quando ele continua na lista", () => {
  const r = reconciliarPeriodoSelecionado([{ id: "a" }, { id: "b" }], "b");
  assert.equal(r, "b");
});

test("troca pro primeiro quando o atual sumiu", () => {
  const r = reconciliarPeriodoSelecionado([{ id: "a" }, { id: "c" }], "b");
  assert.equal(r, "a");
});

test('retorna "" quando a lista está vazia', () => {
  const r = reconciliarPeriodoSelecionado([], "b");
  assert.equal(r, "");
});

test('retorna o primeiro quando o atual é ""', () => {
  const r = reconciliarPeriodoSelecionado([{ id: "a" }], "");
  assert.equal(r, "a");
});
