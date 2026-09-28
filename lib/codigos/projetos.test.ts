/**
 * Testes do código de projeto — decisão 114 (P na produção, F no
 * financeiro).
 *
 * Rode com:  node --import tsx --test lib/codigos/projetos.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LETRA_DO_PROJETO,
  LETRA_DO_PROJETO_FINANCEIRO,
  proximoCodigoDeProjeto,
} from "./projetos";

const base = { codigoCurto: "AMB", ano: "26" };

test("o primeiro projeto da sigla é o P001, e o do financeiro o F001", () => {
  assert.equal(
    proximoCodigoDeProjeto({ ...base, letra: LETRA_DO_PROJETO, qtdDoCliente: 0, codigosDaSigla: [] }),
    "AMB-P001/26",
  );
  assert.equal(
    proximoCodigoDeProjeto({
      ...base,
      letra: LETRA_DO_PROJETO_FINANCEIRO,
      qtdDoCliente: 0,
      codigosDaSigla: [],
    }),
    "AMB-F001/26",
  );
});

test("o seguinte é o maior entre a contagem do cliente + 1 e o maior da sigla + 1", () => {
  const codigosDaSigla = ["AMB-P004/26", "AMB-P010/26"];
  assert.equal(
    proximoCodigoDeProjeto({ ...base, letra: "P", qtdDoCliente: 3, codigosDaSigla }),
    "AMB-P011/26",
  );
  assert.equal(
    proximoCodigoDeProjeto({ ...base, letra: "P", qtdDoCliente: 12, codigosDaSigla }),
    "AMB-P013/26",
  );
});

test("o código de antes da troca (zero no lugar da letra) conta: o número não se repete", () => {
  assert.equal(
    proximoCodigoDeProjeto({ ...base, letra: "P", qtdDoCliente: 0, codigosDaSigla: ["AMB-0006/26"] }),
    "AMB-P007/26",
  );
});

test("a letra do outro cadastro, código de job, outra sigla e outro ano não contam", () => {
  const codigosDaSigla = [
    "AMB-F009/26", // projeto do financeiro
    "AMB-1006/26", // job
    "AMB-P020/25", // outro ano
    "AMBX-P030/26", // outra sigla
  ];
  assert.equal(
    proximoCodigoDeProjeto({ ...base, letra: "P", qtdDoCliente: 0, codigosDaSigla }),
    "AMB-P001/26",
  );
  assert.equal(
    proximoCodigoDeProjeto({
      ...base,
      letra: "F",
      qtdDoCliente: 0,
      codigosDaSigla: ["AMB-P009/26", "AMB-F004/26"],
    }),
    "AMB-F005/26",
  );
});
