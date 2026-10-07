import { test } from "node:test";
import assert from "node:assert/strict";
import { janelaDaNf } from "./janela-pagamento";

// Prazo = dia 25 do mês da competência às 23:59:59.999 BRT (UTC-3).
// Em UTC: dia 26 às 02:59:59.999.

test("upload no dia 10 da competência -> janela salários (dia 03 seguinte)", () => {
  const r = janelaDaNf({
    uploadedAt: "2026-10-10T13:00:00.000Z",
    competenciaAno: 2026,
    competenciaMes: 10,
  });
  assert.equal(r.janela, "salarios");
  assert.equal(r.data_prevista, "2026-11-03");
});

test("upload exatamente no dia 25 às 23:59 BRT -> ainda salários", () => {
  // 25/10 23:59:00 BRT == 26/10 02:59:00 UTC
  const r = janelaDaNf({
    uploadedAt: "2026-10-26T02:59:00.000Z",
    competenciaAno: 2026,
    competenciaMes: 10,
  });
  assert.equal(r.janela, "salarios");
  assert.equal(r.data_prevista, "2026-11-03");
});

test("upload no dia 26 00:00 BRT -> fornecedores (dia 08 seguinte)", () => {
  // 26/10 00:00:00 BRT == 26/10 03:00:00 UTC
  const r = janelaDaNf({
    uploadedAt: "2026-10-26T03:00:00.000Z",
    competenciaAno: 2026,
    competenciaMes: 10,
  });
  assert.equal(r.janela, "fornecedores");
  assert.equal(r.data_prevista, "2026-11-08");
});

test("upload atrasado em um ano -> janela fornecedores do mês seguinte à competência", () => {
  const r = janelaDaNf({
    uploadedAt: "2026-10-15T13:00:00.000Z",
    competenciaAno: 2025,
    competenciaMes: 10,
  });
  assert.equal(r.janela, "fornecedores");
  assert.equal(r.data_prevista, "2025-11-08");
});

test("competência de dezembro: salários -> 03/01 do ano seguinte", () => {
  const r = janelaDaNf({
    uploadedAt: "2026-12-10T13:00:00.000Z",
    competenciaAno: 2026,
    competenciaMes: 12,
  });
  assert.equal(r.janela, "salarios");
  assert.equal(r.data_prevista, "2027-01-03");
});

test("competência de dezembro, fora do prazo -> fornecedores 08/01", () => {
  const r = janelaDaNf({
    uploadedAt: "2026-12-28T13:00:00.000Z",
    competenciaAno: 2026,
    competenciaMes: 12,
  });
  assert.equal(r.janela, "fornecedores");
  assert.equal(r.data_prevista, "2027-01-08");
});
