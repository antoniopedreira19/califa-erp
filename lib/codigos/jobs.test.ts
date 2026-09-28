/**
 * Testes do código de job — decisão 114.
 *
 * Rode com:  node --import tsx --test lib/codigos/jobs.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  anoDoCodigoDeJob,
  compararCodigosDeJob,
  proximoCodigoDeJob,
} from "./jobs";

test("em 2026 o primeiro job da sigla é o 1001", () => {
  assert.equal(proximoCodigoDeJob({ sigla: "AMB", ano: "26", codigos: [] }), "AMB-1001/26");
});

test("o seguinte é o maior da sigla e do ano + 1", () => {
  const codigos = ["AMB-1001/26", "AMB-1009/26", "TES-1012/26", "AMB-1004/26"];
  assert.equal(proximoCodigoDeJob({ sigla: "AMB", ano: "26", codigos }), "AMB-1010/26");
  assert.equal(proximoCodigoDeJob({ sigla: "TES", ano: "26", codigos }), "TES-1013/26");
});

test("número queimado não volta: o buraco não é reaproveitado", () => {
  const codigos = ["AMB-1001/26", "AMB-1005/26"];
  assert.equal(proximoCodigoDeJob({ sigla: "AMB", ano: "26", codigos }), "AMB-1006/26");
});

test("de 2027 em diante o sequencial começa em 0001", () => {
  const codigos = ["AMB-1009/26"];
  assert.equal(proximoCodigoDeJob({ sigla: "AMB", ano: "27", codigos }), "AMB-0001/27");
  assert.equal(
    proximoCodigoDeJob({ sigla: "AMB", ano: "27", codigos: ["AMB-0001/27", "AMB-0002/27"] }),
    "AMB-0003/27",
  );
});

test("código antigo JOB-NNNN e código de projeto não contam", () => {
  const codigos = ["JOB-0051", "AMB-0006/26", "AMB-0006/26-01", "AMBX-1003/26"];
  assert.equal(proximoCodigoDeJob({ sigla: "AMB", ano: "26", codigos }), "AMB-1001/26");
});

test("o ano vem da data de hoje", () => {
  assert.equal(anoDoCodigoDeJob("2026-12-31"), "26");
  assert.equal(anoDoCodigoDeJob("2027-01-01"), "27");
});

test("ordem cronológica: ano, depois número, e o código antigo antes", () => {
  const codigos = ["AMB-0001/27", "AMB-1005/26", "JOB-0036", "AMB-1001/26"];
  assert.deepEqual([...codigos].sort(compararCodigosDeJob), [
    "JOB-0036",
    "AMB-1001/26",
    "AMB-1005/26",
    "AMB-0001/27",
  ]);
});
