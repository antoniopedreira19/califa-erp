import { test } from "node:test";
import assert from "node:assert/strict";

import { subtipoDoTitulo, subtipoUnicoPorTipo } from "./subtipo-unico";

const subtipos = [
  // 02 · Custo Operacional: um só ativo.
  { id: "geral", tipo_id: "02", ativo: true },
  // 04 · Custo Fixo: dois ativos.
  { id: "aluguel", tipo_id: "04", ativo: true },
  { id: "energia", tipo_id: "04", ativo: true },
  // 06: um ativo e um inativo — o inativo não conta.
  { id: "midia", tipo_id: "06", ativo: true },
  { id: "antigo", tipo_id: "06", ativo: false },
  // 09: só inativo.
  { id: "velho", tipo_id: "09", ativo: false },
];
const unico = subtipoUnicoPorTipo(subtipos);

test("o tipo com um subtipo ativo completa o centro", () => {
  assert.equal(subtipoDoTitulo("02", null, unico), "geral");
});

test("o inativo não conta: o único ativo vale", () => {
  assert.equal(subtipoDoTitulo("06", null, unico), "midia");
});

test("o tipo com dois subtipos ativos continua pedindo a escolha", () => {
  assert.equal(subtipoDoTitulo("04", null, unico), null);
});

test("o tipo sem subtipo ativo fica sem subtipo", () => {
  assert.equal(subtipoDoTitulo("09", null, unico), null);
});

test("o subtipo que o título já tem nunca é trocado", () => {
  assert.equal(subtipoDoTitulo("02", "outro", unico), "outro");
  assert.equal(subtipoDoTitulo("04", "aluguel", unico), "aluguel");
});

test("sem tipo, não há subtipo a completar", () => {
  assert.equal(subtipoDoTitulo(null, null, unico), null);
});
