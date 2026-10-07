/**
 * Testes da data-limite de envio da PP — decisão 157 (07/10/2026).
 *
 * Rode com:  node --import tsx --test lib/calculos/janelas-pagamento.test.ts
 *
 * Os casos de agosto a dezembro de 2026 são as linhas do calendário que o
 * financeiro mandou ("Calendário de envio de PPs"); as que caem em fim de
 * semana voltam ao dia útil anterior, como o Tiago pediu.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dataLimiteDeEnvio,
  janelasComEnvioAberto,
  ppSegueOPrazoDeEnvio,
  primeiraJanelaComEnvioAberto,
  vencimentoAceitaEnvio,
} from "./janelas-pagamento";

test("as linhas do calendário do financeiro (dia útil)", () => {
  const casos: Array<[string, string]> = [
    ["2026-08-10", "2026-07-24"], // 08/08 é sábado: paga 10/08, limite pelo 08
    ["2026-08-20", "2026-08-05"],
    ["2026-09-08", "2026-08-24"],
    ["2026-09-21", "2026-09-04"], // 20/09 domingo; 05/09 sábado → sexta 04/09
    ["2026-10-08", "2026-09-23"],
    ["2026-10-20", "2026-10-05"],
    ["2026-11-09", "2026-10-23"], // 08/11 domingo; 24/10 sábado → sexta 23/10
    ["2026-11-20", "2026-11-05"],
    ["2026-12-08", "2026-11-23"],
    ["2026-12-21", "2026-12-04"], // 20/12 domingo; 05/12 sábado → sexta 04/12
  ];
  for (const [vencimento, limite] of casos) {
    assert.equal(dataLimiteDeEnvio(vencimento), limite, vencimento);
  }
});

test("domingo volta para a sexta, não para o sábado", () => {
  // 08/02/2027 − 15 = domingo, 24/01/2027.
  assert.equal(dataLimiteDeEnvio("2027-02-08"), "2027-01-22");
});

test("feriado nacional também volta ao dia útil anterior", () => {
  // Limite de 20/10/2026 é segunda 05/10; se 05/10 fosse feriado, sexta 02/10.
  assert.equal(dataLimiteDeEnvio("2026-10-20", ["2026-10-05"]), "2026-10-02");
  // Feriado em outro dia não mexe.
  assert.equal(dataLimiteDeEnvio("2026-10-20", ["2026-10-12"]), "2026-10-05");
});

test("data fora das janelas não tem data-limite", () => {
  assert.equal(dataLimiteDeEnvio("2026-10-15"), null);
  assert.equal(vencimentoAceitaEnvio("2026-10-15", "2026-10-01"), false);
});

test("o limite é inclusivo", () => {
  assert.equal(vencimentoAceitaEnvio("2026-11-09", "2026-10-23"), true);
  assert.equal(vencimentoAceitaEnvio("2026-11-09", "2026-10-24"), false);
});

test("em 07/10/2026 a primeira janela possível é a de 08/11 (paga 09/11)", () => {
  assert.equal(primeiraJanelaComEnvioAberto("2026-10-07"), "2026-11-09");
  assert.deepEqual(janelasComEnvioAberto("2026-10-07", [], 4), [
    "2026-11-09",
    "2026-11-20",
    "2026-12-08",
    "2026-12-21",
  ]);
});

test("no dia seguinte ao limite de 08/11, a primeira é a de 20/11", () => {
  assert.equal(primeiraJanelaComEnvioAberto("2026-10-24"), "2026-11-20");
  assert.equal(primeiraJanelaComEnvioAberto("2026-10-23"), "2026-11-09");
});

test("virada de ano", () => {
  // Limite de 08/01/2027 é 24/12/2026 (quinta).
  assert.equal(primeiraJanelaComEnvioAberto("2026-12-24"), "2027-01-08");
  assert.equal(primeiraJanelaComEnvioAberto("2026-12-25"), "2027-01-20");
});

test("PP gerada antes de 08/10/2026 (São Paulo) fica fora da regra", () => {
  assert.equal(ppSegueOPrazoDeEnvio("2026-10-07T12:00:00Z"), false);
  // 23h59 de 07/10 em São Paulo ainda é 07/10, mesmo já sendo 08/10 em UTC.
  assert.equal(ppSegueOPrazoDeEnvio("2026-10-08T02:59:00Z"), false);
  assert.equal(ppSegueOPrazoDeEnvio("2026-10-08T03:00:00Z"), true);
  assert.equal(ppSegueOPrazoDeEnvio(null), true);
});
