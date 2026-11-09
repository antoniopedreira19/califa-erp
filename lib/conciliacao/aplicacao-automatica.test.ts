/**
 * Testes da trava do extrato completo da conta com aplicação automática
 * (decisão 249).
 *
 * Rode com:  node --import tsx --test lib/conciliacao/aplicacao-automatica.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { faltamAsAplicacoes } from "./aplicacao-automatica";

const SANTANDER = ["APLICACAO CONTAMAX", "RESGATE CONTAMAX AUTOMATICO"];

test("o extrato completo, com o resgate do dia, passa", () => {
  const movs = [
    { data: "2026-10-30", historico: "PGTO FORNECEDORES - TRIB FEDERAL" },
    { data: "2026-10-30", historico: "RESGATE CONTAMAX AUTOMATICO" },
  ];
  assert.equal(faltamAsAplicacoes(movs, SANTANDER, "2026-11-03"), false);
});

test("o formato novo, sem nenhuma aplicação em dia fechado, é recusado", () => {
  const movs = [
    { data: "2026-10-28", historico: "PAGFOR PIX OUTRA INST" },
    { data: "2026-10-29", historico: "PIX RECEBIDO" },
  ];
  assert.equal(faltamAsAplicacoes(movs, SANTANDER, "2026-10-31"), true);
});

test("só o dia em que o arquivo foi gerado: a aplicação ainda não aconteceu", () => {
  const movs = [{ data: "2026-11-03", historico: "PIX RECEBIDO" }];
  assert.equal(faltamAsAplicacoes(movs, SANTANDER, "2026-11-03"), false);
});

test("o histórico com acento e o padrão sem acento se reconhecem", () => {
  const movs = [
    { data: "2026-10-23", historico: "TED-PAG FORNECEDORES" },
    { data: "2026-10-23", historico: "BB RENDE FÁCIL - RENDE FACIL" },
  ];
  assert.equal(faltamAsAplicacoes(movs, ["BB RENDE FACIL"], "2026-11-03"), false);
});

test("conta sem regra da aplicação: não há como conferir, a importação segue", () => {
  const movs = [{ data: "2026-10-28", historico: "PIX RECEBIDO" }];
  assert.equal(faltamAsAplicacoes(movs, [], "2026-11-03"), false);
});
