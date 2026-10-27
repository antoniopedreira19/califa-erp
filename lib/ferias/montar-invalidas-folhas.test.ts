/**
 * Testes unitários de `montarInvalidasFolhas`.
 *
 * Função pura — sem Supabase, sem "use server".
 *
 * Framework: node:test + tsx
 * Rodar: node --import tsx --test lib/ferias/montar-invalidas-folhas.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { montarInvalidasFolhas } from "./montar-invalidas-folhas";
import type { FolhaParaValidar } from "./montar-invalidas-folhas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function folha(overrides: Partial<FolhaParaValidar> = {}): FolhaParaValidar {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tipo: "ferias",
    status: "rascunho",
    origem: "contabilidade",
    anexo_url: "https://exemplo.com/recibo.pdf",
    lancamento_ferias_id: "00000000-0000-0000-0000-000000000010",
    tipo_folha_ferias: "usufruto",
    ...overrides,
  };
}

const semNfs = new Set<string>();

// ---------------------------------------------------------------------------
// 1. CLT sem recibo → inválida
// ---------------------------------------------------------------------------

test("CLT sem recibo → inválida", () => {
  const f = folha({ origem: "contabilidade", anexo_url: null });
  const result = montarInvalidasFolhas([f], semNfs);
  assert.equal(result.length, 1);
  assert.match(result[0], /CLT sem recibo contábil anexado/);
});

// ---------------------------------------------------------------------------
// 2. CLT com recibo → ok
// ---------------------------------------------------------------------------

test("CLT com recibo → ok", () => {
  const f = folha({ origem: "contabilidade", anexo_url: "https://exemplo.com/recibo.pdf" });
  const result = montarInvalidasFolhas([f], semNfs);
  assert.equal(result.length, 0);
});

// ---------------------------------------------------------------------------
// 3. PJ usufruto sem NF → inválida
// ---------------------------------------------------------------------------

test("PJ usufruto sem NF → inválida", () => {
  const lancamentoId = "00000000-0000-0000-0000-000000000010";
  const f = folha({
    origem: "california",
    anexo_url: null,
    lancamento_ferias_id: lancamentoId,
    tipo_folha_ferias: "usufruto",
  });
  const result = montarInvalidasFolhas([f], semNfs);
  assert.equal(result.length, 1);
  assert.match(result[0], /PJ sem NF anexada pelo colaborador/);
});

// ---------------------------------------------------------------------------
// 4. PJ usufruto com NF → ok
// ---------------------------------------------------------------------------

test("PJ usufruto com NF → ok", () => {
  const lancamentoId = "00000000-0000-0000-0000-000000000010";
  const f = folha({
    origem: "california",
    anexo_url: null,
    lancamento_ferias_id: lancamentoId,
    tipo_folha_ferias: "usufruto",
  });
  const nfs = new Set([`${lancamentoId}|ferias_usufruto`]);
  const result = montarInvalidasFolhas([f], nfs);
  assert.equal(result.length, 0);
});

// ---------------------------------------------------------------------------
// 5. PJ abono sem NF → inválida
// ---------------------------------------------------------------------------

test("PJ abono sem NF → inválida", () => {
  const lancamentoId = "00000000-0000-0000-0000-000000000010";
  const f = folha({
    origem: "california",
    anexo_url: null,
    lancamento_ferias_id: lancamentoId,
    tipo_folha_ferias: "abono",
  });
  const result = montarInvalidasFolhas([f], semNfs);
  assert.equal(result.length, 1);
  assert.match(result[0], /PJ sem NF anexada pelo colaborador/);
});

// ---------------------------------------------------------------------------
// 6. tipo != ferias → inválida
// ---------------------------------------------------------------------------

test("tipo != ferias → inválida", () => {
  const f = folha({ tipo: "mensal" });
  const result = montarInvalidasFolhas([f], semNfs);
  assert.equal(result.length, 1);
  assert.match(result[0], /não é folha de férias/);
});

// ---------------------------------------------------------------------------
// 7. status != rascunho → inválida
// ---------------------------------------------------------------------------

test("status != rascunho → inválida", () => {
  const f = folha({ status: "enviada" });
  const result = montarInvalidasFolhas([f], semNfs);
  assert.equal(result.length, 1);
  assert.match(result[0], /só rascunho pode ser enviada/);
});

// ---------------------------------------------------------------------------
// 8. PJ com tipo_folha_ferias=null → inválida (sem tipo)
// ---------------------------------------------------------------------------

test("PJ com tipo_folha_ferias=null → inválida (sem tipo)", () => {
  const f = folha({
    origem: "california",
    tipo_folha_ferias: null,
  });
  const result = montarInvalidasFolhas([f], semNfs);
  assert.equal(result.length, 1);
  assert.match(result[0], /PJ sem tipo de folha de férias/);
});
