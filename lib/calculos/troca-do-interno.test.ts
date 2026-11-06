import { test } from "node:test";
import assert from "node:assert/strict";
import {
  linhasDepoisDaTroca,
  planejadoDepoisDaTroca,
  rotuloDosTipos,
  sentidoDaTroca,
  tipoDepoisDaTroca,
  tiposDasLinhas,
} from "./troca-do-interno";

test("o sentido sai do lado do orçamento e do serviço novo", () => {
  assert.equal(sentidoDaTroca(false, true), "entra");
  assert.equal(sentidoDaTroca(true, false), "sai");
  assert.equal(sentidoDaTroca(false, false), null);
  assert.equal(sentidoDaTroca(true, true), null);
});

test("entrar põe toda linha em FI, até A e D", () => {
  for (const t of ["A", "AR", "B", "C", "D", "F", "FI"] as const) {
    assert.equal(tipoDepoisDaTroca(t, "entra"), "FI");
  }
});

test("sair troca só o FI por B", () => {
  assert.equal(tipoDepoisDaTroca("FI", "sai"), "B");
  assert.equal(tipoDepoisDaTroca("A", "sai"), "A");
  const linhas = linhasDepoisDaTroca([{ tipo_custo: "FI" as const, id: "1" }], "sai");
  assert.deepEqual(linhas, [{ tipo_custo: "B", id: "1" }]);
});

test("o planejado vira o orçado só na entrada", () => {
  const linha = { total_orcado: 5000, total_planejado: 4000 };
  assert.equal(planejadoDepoisDaTroca(linha, "entra"), 5000);
  assert.equal(planejadoDepoisDaTroca(linha, "sai"), 4000);
});

test("os tipos saem sem repetir, na ordem da planilha, só com as siglas", () => {
  const tipos = tiposDasLinhas([
    { tipo_custo: "D" },
    { tipo_custo: "B" },
    { tipo_custo: "B" },
    { tipo_custo: "A" },
  ]);
  assert.deepEqual(tipos, ["A", "B", "D"]);
  assert.equal(rotuloDosTipos(tipos), "A, B e D");
  assert.equal(rotuloDosTipos(["B"]), "B");
});
