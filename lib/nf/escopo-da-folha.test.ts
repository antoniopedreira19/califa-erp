/**
 * Testes de resolverEscopoDaFolha. Rodar:
 * node --import tsx --test "lib/nf/escopo-da-folha.test.ts"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolverEscopoDaFolha } from "./escopo-da-folha";

const FOLHA_ID = "folha-abc-123";
const LANCAMENTO_ID = "lancamento-ferias-456";

test("resolverEscopoDaFolha retorna folha_mensal para tipo=salario", () => {
  const resultado = resolverEscopoDaFolha({
    id: FOLHA_ID,
    tipo: "salario",
    tipo_folha_ferias: null,
    lancamento_ferias_id: null,
  });
  assert.deepEqual(resultado, {
    escopo_tipo: "folha_mensal",
    escopo_id: FOLHA_ID,
  });
});

test("resolverEscopoDaFolha retorna ferias_usufruto para tipo=ferias + tipo_folha_ferias=usufruto", () => {
  const resultado = resolverEscopoDaFolha({
    id: FOLHA_ID,
    tipo: "ferias",
    tipo_folha_ferias: "usufruto",
    lancamento_ferias_id: LANCAMENTO_ID,
  });
  assert.deepEqual(resultado, {
    escopo_tipo: "ferias_usufruto",
    escopo_id: LANCAMENTO_ID,
  });
});

test("resolverEscopoDaFolha retorna ferias_abono para tipo=ferias + tipo_folha_ferias=abono", () => {
  const resultado = resolverEscopoDaFolha({
    id: FOLHA_ID,
    tipo: "ferias",
    tipo_folha_ferias: "abono",
    lancamento_ferias_id: LANCAMENTO_ID,
  });
  assert.deepEqual(resultado, {
    escopo_tipo: "ferias_abono",
    escopo_id: LANCAMENTO_ID,
  });
});

test("resolverEscopoDaFolha retorna null para 13° (stub)", () => {
  for (const tipo of [
    "decimo_terceiro_1a_parcela",
    "decimo_terceiro_2a_parcela",
  ] as const) {
    const resultado = resolverEscopoDaFolha({
      id: FOLHA_ID,
      tipo,
      tipo_folha_ferias: null,
      lancamento_ferias_id: null,
    });
    assert.strictEqual(resultado, null, `${tipo} deve retornar null (stub)`);
  }
});

test("resolverEscopoDaFolha retorna null para ferias sem lancamento_ferias_id", () => {
  const resultado = resolverEscopoDaFolha({
    id: FOLHA_ID,
    tipo: "ferias",
    tipo_folha_ferias: "usufruto",
    lancamento_ferias_id: null,
  });
  assert.strictEqual(resultado, null);
});
