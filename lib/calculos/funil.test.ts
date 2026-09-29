/**
 * Testes do job vivo do orçamento — o código que a lista de orçamentos do
 * projeto mostra no lugar do código do orçamento (29/09/2026).
 *
 * Rode com:  node --import tsx --test lib/calculos/funil.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { jobVivoDoOrcamento } from "./funil";

test("Sem job: nulo", () => {
  assert.equal(jobVivoDoOrcamento([]), null);
});

test("Só cancelado: nulo — o número do job cancelado morreu", () => {
  assert.equal(
    jobVivoDoOrcamento([
      { codigo: "TES-1010/26", status: "cancelado", created_at: "2026-09-25T13:21:03Z" },
    ]),
    null,
  );
});

test("Cancelado e reenviado: vale o vivo, mesmo o cancelado sendo mais novo", () => {
  const vivo = jobVivoDoOrcamento([
    { codigo: "TES-1012/26", status: "aguardando_abertura", created_at: "2026-09-25T20:59:23Z" },
    { codigo: "TES-1011/26", status: "cancelado", created_at: "2026-09-25T21:30:00Z" },
  ]);
  assert.equal(vivo?.codigo, "TES-1012/26");
});

test("Aguardando abertura já tem código e conta como vivo", () => {
  const vivo = jobVivoDoOrcamento([
    { codigo: "TES-1011/26", status: "cancelado", created_at: "2026-09-25T18:36:43Z" },
    { codigo: "TES-1012/26", status: "aguardando_abertura", created_at: "2026-09-25T20:59:23Z" },
  ]);
  assert.equal(vivo?.codigo, "TES-1012/26");
});
