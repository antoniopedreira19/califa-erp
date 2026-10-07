import { test } from "node:test";
import assert from "node:assert/strict";
import { diasAtePrazoNf } from "./countdown-nf";

test("hoje é dia 7, competência outubro -> faltam 18 dias", () => {
  const r = diasAtePrazoNf({
    hoje: new Date("2026-10-07T15:00:00.000Z"),
    competenciaAno: 2026,
    competenciaMes: 10,
  });
  assert.equal(r.diasRestantes, 18);
  assert.equal(r.vencido, false);
  assert.match(r.mensagem, /faltam 18 dias/i);
});

test("hoje é dia 25 -> último dia do prazo", () => {
  const r = diasAtePrazoNf({
    hoje: new Date("2026-10-25T15:00:00.000Z"),
    competenciaAno: 2026,
    competenciaMes: 10,
  });
  assert.equal(r.diasRestantes, 0);
  assert.equal(r.vencido, false);
  assert.match(r.mensagem, /último dia/i);
});

test("hoje é dia 26 -> prazo vencido (fornecedores)", () => {
  const r = diasAtePrazoNf({
    hoje: new Date("2026-10-26T15:00:00.000Z"),
    competenciaAno: 2026,
    competenciaMes: 10,
  });
  assert.ok(r.diasRestantes < 0);
  assert.equal(r.vencido, true);
  assert.match(r.mensagem, /prazo vencido/i);
  assert.match(r.mensagem, /fornecedores/i);
});

test("hoje é dia 24 -> faltam 1 dia (singular)", () => {
  const r = diasAtePrazoNf({
    hoje: new Date("2026-10-24T15:00:00.000Z"),
    competenciaAno: 2026,
    competenciaMes: 10,
  });
  assert.equal(r.diasRestantes, 1);
  assert.match(r.mensagem, /falta 1 dia/i);
});

test("competência futura (novembro, hoje é outubro) -> contagem continua", () => {
  const r = diasAtePrazoNf({
    hoje: new Date("2026-10-07T15:00:00.000Z"),
    competenciaAno: 2026,
    competenciaMes: 11,
  });
  assert.ok(r.diasRestantes > 18);
  assert.equal(r.vencido, false);
});
