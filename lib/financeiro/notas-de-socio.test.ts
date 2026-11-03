import { test } from "node:test";
import assert from "node:assert/strict";
import { centroDasNotasDeSocio, ehCentroDasNotas, ehNotasDeSocio } from "./notas-de-socio";

const tipos = [
  { id: "t10", codigo: "10" },
  { id: "t15", codigo: "15" },
];
const subtipos = [
  { id: "s10", tipo_id: "t10", codigo: "001" },
  { id: "s15", tipo_id: "t15", codigo: "001" },
  { id: "s15g", tipo_id: "t15", codigo: "999" },
];

test("o centro é o 15.001, e não o 001 de outro tipo", () => {
  assert.deepEqual(centroDasNotasDeSocio(tipos, subtipos), { tipoId: "t15", subtipoId: "s15" });
  assert.equal(ehNotasDeSocio(tipos, subtipos, "s15"), true);
  assert.equal(ehNotasDeSocio(tipos, subtipos, "s10"), false);
  assert.equal(ehNotasDeSocio(tipos, subtipos, "s15g"), false);
});

test("pelos códigos, só o 15.001", () => {
  assert.equal(ehCentroDasNotas("15", "001"), true);
  assert.equal(ehCentroDasNotas("15", "999"), false);
  assert.equal(ehCentroDasNotas("10", "001"), false);
  assert.equal(ehCentroDasNotas(null, null), false);
});

test("sem o subtipo no plano, ou sem subtipo escolhido, não é nota", () => {
  assert.equal(centroDasNotasDeSocio(tipos, [subtipos[0]]), null);
  assert.equal(ehNotasDeSocio(tipos, [subtipos[0]], "s15"), false);
  assert.equal(ehNotasDeSocio(tipos, subtipos, ""), false);
  assert.equal(ehNotasDeSocio(tipos, subtipos, null), false);
});
