import { test } from "node:test";
import assert from "node:assert/strict";
import { linhaFolhaSchema, valorDaFolhaParaNumero } from "./rh-folhas";

// Decisão 132: o mesmo valor, venha do painel do RH (pt-BR) ou do painel de
// aprovação do financeiro (decimal com ponto), tem de dar o mesmo número.
// Antes, "5248.48" virava 524848 — o título de R$ 524.848,00 de 29/09.

const aloc = [
  {
    empresa_id: "304039bd-509d-4536-aa26-44e7091ee718",
    regional_id: "29b8e2d0-3fe9-4380-86b0-ede8299c2c32",
    percentual: "100.00",
  },
];

function salario(v: string): string {
  const r = linhaFolhaSchema.safeParse({ salario_base: v, alocacoes: aloc });
  assert.ok(r.success, `não validou ${v}`);
  return r.data.salario_base;
}

test("decimal com ponto, como manda a aprovação do financeiro", () => {
  assert.equal(salario("5248.48"), "5248.48");
  assert.equal(salario("3400.00"), "3400.00");
  assert.equal(salario("14662.68"), "14662.68");
  assert.equal(salario("286.35"), "286.35");
});

test("número inteiro, como o banco devolve", () => {
  assert.equal(salario("12000"), "12000.00");
  assert.equal(salario("3500"), "3500.00");
});

test("texto pt-BR do campo de moeda, como manda o painel do RH", () => {
  assert.equal(salario("5.248,48"), "5248.48");
  assert.equal(salario("7.000,00"), "7000.00");
  assert.equal(salario("1.413.897,61"), "1413897.61");
  assert.equal(salario("0,03"), "0.03");
});

test("valorDaFolhaParaNumero não multiplica por 100", () => {
  assert.equal(valorDaFolhaParaNumero("5248.48"), 5248.48);
  assert.equal(valorDaFolhaParaNumero("5.248,48"), 5248.48);
});

test("zero e texto inválido continuam recusados", () => {
  assert.equal(linhaFolhaSchema.safeParse({ salario_base: "0", alocacoes: aloc }).success, false);
  assert.equal(linhaFolhaSchema.safeParse({ salario_base: "abc", alocacoes: aloc }).success, false);
});
