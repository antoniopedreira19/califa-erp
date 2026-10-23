/**
 * Testes do código de projeto — decisão 210 ("P-0001/26" na produção,
 * "F-0001/26" no financeiro, sem a sigla do cliente).
 *
 * Rode com:  node --import tsx --test lib/codigos/projetos.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LETRA_DO_PROJETO,
  LETRA_DO_PROJETO_FINANCEIRO,
  anoDoCodigoDeProjeto,
  proximoCodigoDeProjeto,
} from "./projetos";

test("o primeiro projeto do ano é o P-0001, e o do financeiro o F-0001", () => {
  assert.equal(
    proximoCodigoDeProjeto({ letra: LETRA_DO_PROJETO, ano: "26", codigosUsados: [] }),
    "P-0001/26",
  );
  assert.equal(
    proximoCodigoDeProjeto({ letra: LETRA_DO_PROJETO_FINANCEIRO, ano: "26", codigosUsados: [] }),
    "F-0001/26",
  );
});

test("o seguinte é o maior já usado + 1, mesmo com buraco no meio", () => {
  assert.equal(
    proximoCodigoDeProjeto({
      letra: "P",
      ano: "26",
      // O P-0007 está no registro de usados: projeto apagado não devolve o número.
      codigosUsados: ["P-0001/26", "P-0004/26", "P-0007/26"],
    }),
    "P-0008/26",
  );
});

test("a outra letra, outro ano, o formato antigo e código de job não contam", () => {
  const codigosUsados = [
    "F-0009/26", // projeto do financeiro
    "P-0020/25", // outro ano
    "AMB-P030/26", // projeto antes da 210
    "AMB-1006/26", // job
  ];
  assert.equal(
    proximoCodigoDeProjeto({ letra: "P", ano: "26", codigosUsados }),
    "P-0001/26",
  );
  assert.equal(
    proximoCodigoDeProjeto({ letra: "F", ano: "26", codigosUsados }),
    "F-0010/26",
  );
});

test("passa de 9999 sem cortar o número", () => {
  assert.equal(
    proximoCodigoDeProjeto({ letra: "P", ano: "26", codigosUsados: ["P-9999/26"] }),
    "P-10000/26",
  );
});

test("o ano é o de hoje, pelo texto da data", () => {
  assert.equal(anoDoCodigoDeProjeto("2027-01-01"), "27");
  assert.equal(anoDoCodigoDeProjeto("2026-12-31"), "26");
});
