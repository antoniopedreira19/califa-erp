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
    decimo_terceiro_linha_id: null,
    decimo_terceiro_adiantamento_id: null,
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
    decimo_terceiro_linha_id: null,
    decimo_terceiro_adiantamento_id: null,
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
    decimo_terceiro_linha_id: null,
    decimo_terceiro_adiantamento_id: null,
  });
  assert.deepEqual(resultado, {
    escopo_tipo: "ferias_abono",
    escopo_id: LANCAMENTO_ID,
  });
});

test("resolverEscopoDaFolha retorna decimo_terceiro_p1 para 1a parcela com linha vinculada", () => {
  const resultado = resolverEscopoDaFolha({
    id: FOLHA_ID,
    tipo: "decimo_terceiro_1a_parcela",
    tipo_folha_ferias: null,
    lancamento_ferias_id: null,
    decimo_terceiro_linha_id: "linha-13-abc",
    decimo_terceiro_adiantamento_id: null,
  });
  assert.deepEqual(resultado, { escopo_tipo: "decimo_terceiro_p1", escopo_id: "linha-13-abc" });
});

test("resolverEscopoDaFolha retorna decimo_terceiro_p2 para 2a parcela com linha vinculada", () => {
  const resultado = resolverEscopoDaFolha({
    id: FOLHA_ID,
    tipo: "decimo_terceiro_2a_parcela",
    tipo_folha_ferias: null,
    lancamento_ferias_id: null,
    decimo_terceiro_linha_id: "linha-13-def",
    decimo_terceiro_adiantamento_id: null,
  });
  assert.deepEqual(resultado, { escopo_tipo: "decimo_terceiro_p2", escopo_id: "linha-13-def" });
});

test("resolverEscopoDaFolha retorna decimo_terceiro_adiantamento quando adiantamento_id presente", () => {
  const resultado = resolverEscopoDaFolha({
    id: FOLHA_ID,
    tipo: "decimo_terceiro_adiantamento",
    tipo_folha_ferias: null,
    lancamento_ferias_id: null,
    decimo_terceiro_linha_id: null,
    decimo_terceiro_adiantamento_id: "adiantamento-xyz",
  });
  assert.deepEqual(resultado, { escopo_tipo: "decimo_terceiro_adiantamento", escopo_id: "adiantamento-xyz" });
});

test("resolverEscopoDaFolha retorna null para 13° sem linha vinculada (defensivo)", () => {
  const resultado = resolverEscopoDaFolha({
    id: FOLHA_ID,
    tipo: "decimo_terceiro_1a_parcela",
    tipo_folha_ferias: null,
    lancamento_ferias_id: null,
    decimo_terceiro_linha_id: null,
    decimo_terceiro_adiantamento_id: null,
  });
  assert.strictEqual(resultado, null);
});

test("resolverEscopoDaFolha retorna null para ferias sem lancamento_ferias_id", () => {
  const resultado = resolverEscopoDaFolha({
    id: FOLHA_ID,
    tipo: "ferias",
    tipo_folha_ferias: "usufruto",
    lancamento_ferias_id: null,
    decimo_terceiro_linha_id: null,
    decimo_terceiro_adiantamento_id: null,
  });
  assert.strictEqual(resultado, null);
});
