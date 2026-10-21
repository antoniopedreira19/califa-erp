/**
 * Testes da baixa com juros no Extrato (decisão 196): uma linha só, com o
 * que saiu da conta.
 *
 * Rode com:  node --import tsx --test lib/financeiro/juros-no-extrato.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { juntarJurosNaBaixa, type LinhaComJuros } from "./juros-no-extrato";

const linha = (id: string, valor: number, origem: string, de: string | null = null): LinhaComJuros & { descricao: string } => ({
  id,
  valor,
  origem,
  juros_de_lancamento_id: de,
  descricao: id,
});

test("a baixa e os juros viram uma linha, com a soma e os juros à parte", () => {
  const r = juntarJurosNaBaixa([
    linha("a", 100, "avulsa_baixa"),
    linha("b", 2500, "pp_baixa"),
    linha("j", 50, "juros_baixa", "b"),
    linha("c", 300, "titulo_baixa"),
  ]);
  assert.deepEqual(r.linhas.map((l) => [l.id, l.valor]), [["a", 100], ["b", 2550], ["c", 300]]);
  assert.deepEqual(r.juros, { b: 50 });
  assert.equal(r.linhaDoLancamento.get("j"), "b");
  // A linha de juros não some com o que ela carrega: a descrição da baixa fica.
  assert.equal(r.linhas[1].descricao, "b");
});

test("o total do extrato não muda", () => {
  const antes = [linha("b", 2500, "pp_baixa"), linha("j", 50.1, "juros_baixa", "b"), linha("x", 10, "manual")];
  const soma = (xs: LinhaComJuros[]) => xs.reduce((s, l) => s + l.valor, 0);
  assert.equal(soma(juntarJurosNaBaixa(antes).linhas), soma(antes));
});

test("juros sem a baixa na lista ficam na linha deles", () => {
  const r = juntarJurosNaBaixa([linha("j", 50, "juros_baixa", "outra"), linha("a", 100, "pp_baixa")]);
  assert.deepEqual(r.linhas.map((l) => l.id), ["j", "a"]);
  assert.deepEqual(r.juros, {});
});

test("sem juros, a lista volta igual", () => {
  const xs = [linha("a", 100, "pp_baixa"), linha("b", 200, "avulsa_baixa")];
  const r = juntarJurosNaBaixa(xs);
  assert.deepEqual(r.linhas, xs);
  assert.equal(r.linhaDoLancamento.size, 0);
});
