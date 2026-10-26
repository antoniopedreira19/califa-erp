import { test } from "node:test";
import assert from "node:assert/strict";
import { escopoParaFkTabela } from "./anexos-escopo";

test("folha_mensal mapeia pra folhas_pagamento.id", () => {
  assert.deepEqual(escopoParaFkTabela("folha_mensal"), {
    tabela: "folhas_pagamento",
    coluna: "id",
  });
});

test("ferias_usufruto e ferias_abono mapeiam pra colaboradores_ferias_lancamentos.id", () => {
  for (const e of ["ferias_usufruto", "ferias_abono"] as const) {
    assert.equal(escopoParaFkTabela(e).tabela, "colaboradores_ferias_lancamentos");
    assert.equal(escopoParaFkTabela(e).coluna, "id");
  }
});

test("decimo_terceiro_p1 e _p2 mapeiam pra decimo_terceiro_linhas.id", () => {
  for (const e of ["decimo_terceiro_p1", "decimo_terceiro_p2"] as const) {
    assert.equal(escopoParaFkTabela(e).tabela, "decimo_terceiro_linhas");
    assert.equal(escopoParaFkTabela(e).coluna, "id");
  }
});
