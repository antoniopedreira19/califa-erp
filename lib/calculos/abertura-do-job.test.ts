import { test } from "node:test";
import assert from "node:assert/strict";
import { rentabilidadeDoJob } from "./abertura-do-job";

// A Rentabilidade da abertura e das listas do financeiro (decisão 207):
// valor do job − impostos − custo planejado, em R$ e em % do valor do job.

test("rentabilidade: valor do job menos impostos e custo planejado", () => {
  const r = rentabilidadeDoJob({ valorJob: 100_000, deducoes: 19_530, custoPlanejado: 55_000 });
  assert.equal(r.valor, 25_470);
  assert.equal(Math.round(r.percentual * 100) / 100, 25.47);
});

test("rentabilidade: arredonda ao centavo antes do percentual", () => {
  const r = rentabilidadeDoJob({ valorJob: 1000, deducoes: 195.304, custoPlanejado: 500.001 });
  assert.equal(r.valor, 304.7);
  assert.equal(r.percentual, 30.47);
});

test("rentabilidade: negativa fica negativa", () => {
  const r = rentabilidadeDoJob({ valorJob: 10_000, deducoes: 1_953, custoPlanejado: 12_000 });
  assert.equal(r.valor, -3_953);
  assert.equal(r.percentual, -39.53);
});

test("rentabilidade: sem valor do job, percentual zero", () => {
  const r = rentabilidadeDoJob({ valorJob: 0, deducoes: 0, custoPlanejado: 12_500 });
  assert.equal(r.valor, -12_500);
  assert.equal(r.percentual, 0);
});
