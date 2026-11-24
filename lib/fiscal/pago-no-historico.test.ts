/**
 * A conferência do imposto pago no histórico (decisão 277, entrega 3).
 *
 * Rodar: node --import tsx --test lib/fiscal/pago-no-historico.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ehLinhaDeImposto, gruposDoHistorico } from "./pago-no-historico";

test("só as linhas de imposto: o centro tributário (03) ou a descrição", () => {
  assert.equal(ehLinhaDeImposto({ plano_codigo: "03.999", descricao: "Qualquer coisa" }), true);
  assert.equal(ehLinhaDeImposto({ plano_codigo: "15.999", descricao: "COFINS" }), true);
  assert.equal(ehLinhaDeImposto({ plano_codigo: "02.999", descricao: "PP-00202 Transmissão" }), false);
  assert.equal(ehLinhaDeImposto({ plano_codigo: "07.006", descricao: "NÃO ENTENDI ISSO" }), false);
  assert.equal(ehLinhaDeImposto({ plano_codigo: "02.999", descricao: "APRESENTAÇÃO ARTÍSTICA - TRIBUTO A UMA BANDA" }), false);
});

test("a guia dividida por gerencial e trimestre, com o crédito positivo, soma o valor dela", () => {
  const grupos = gruposDoHistorico(
    [
      { descricao: "PIS", plano_codigo: "03.999", tipo_planilha: "CT 4T 2026", valor: -60000 },
      { descricao: "PIS ", plano_codigo: "03.999", tipo_planilha: "CMH CT 4T 2026", valor: -21875 },
      { descricao: "pis", plano_codigo: "03.999", tipo_planilha: "CT 4T 2026", valor: 39069.8 },
      { descricao: "COFINS", plano_codigo: "03.999", tipo_planilha: "CT 4T 2026", valor: -377540 },
      { descricao: "Transmissão", plano_codigo: "02.999", tipo_planilha: "CT 4T 2026", valor: -1000 },
    ],
    42805.2,
  );
  assert.deepEqual(
    grupos.map((g) => [g.descricao, g.linhas, g.total, g.bate, g.tipos]),
    [
      ["PIS", 3, -42805.2, true, ["CMH CT 4T 2026", "CT 4T 2026"]],
      ["COFINS", 1, -377540, false, ["CT 4T 2026"]],
    ],
  );
});

test("a linha 'PIS CRÉDITO' soma no grupo do PIS; guias diferentes no mesmo dia ficam separadas", () => {
  const grupos = gruposDoHistorico(
    [
      { descricao: "PIS", plano_codigo: "03.999", tipo_planilha: "CT 4T 2026", valor: -81875 },
      { descricao: "PIS CRÉDITO", plano_codigo: "03.999", tipo_planilha: "CT 4T 2026", valor: 39069.8 },
      { descricao: "COFINS", plano_codigo: "03.999", tipo_planilha: "CT 4T 2026", valor: -377540 },
      { descricao: "COFINS CREDITO", plano_codigo: "03.999", tipo_planilha: "CT 4T 2026", valor: 39069.8 },
      { descricao: "ISS FATURAMENTO SALVADOR", plano_codigo: "03.999", tipo_planilha: "CT 4T 2026", valor: -175230.82 },
      { descricao: "ISS", plano_codigo: "03.999", tipo_planilha: "CT 4T 2026", valor: -9787.91 },
    ],
    42805.2,
  );
  assert.deepEqual(
    grupos.map((g) => [g.descricao, g.linhas, g.total, g.bate]),
    [
      ["PIS", 2, -42805.2, true],
      ["COFINS", 2, -338470.2, false],
      ["ISS FATURAMENTO SALVADOR", 1, -175230.82, false],
      ["ISS", 1, -9787.91, false],
    ],
  );
});

test("sem linha de imposto, nenhum grupo", () => {
  assert.deepEqual(gruposDoHistorico([{ descricao: "Aluguel", plano_codigo: "07.001", tipo_planilha: null, valor: -500 }], 500), []);
});
