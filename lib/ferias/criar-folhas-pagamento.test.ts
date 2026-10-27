/**
 * Testes unitários da lógica PURA de `decidirFolhasAInserir`.
 *
 * Estratégia: testa apenas a função exportada `decidirFolhasAInserir`, que
 * é livre de I/O e pode ser exercida sem Supabase. A persist layer
 * (criarFolhasDePagamentoDeFerias) continua não testada por DI de banco.
 *
 * Framework: node:test + tsx
 * Rodar: npx tsx --test lib/ferias/criar-folhas-pagamento.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirFolhasAInserir } from "./criar-folhas-pagamento";
import type { FolhaAInserir } from "./criar-folhas-pagamento";

// ---------------------------------------------------------------------------
// Fixtures de valores calculados
// ---------------------------------------------------------------------------

const valoresUsufruto = {
  valor_ferias: 3000,
  valor_um_terco: 1000,
  valor_abono: 0,
  valor_total: 4000,
};

const valoresAbono = {
  valor_ferias: 0,
  valor_um_terco: 333.33,
  valor_abono: 1000,
  valor_total: 1333.33,
};

const valoresCombinado = {
  valor_ferias: 3000,
  valor_um_terco: 1000,
  valor_abono: 1000,
  valor_total: 5000,
};

// ---------------------------------------------------------------------------
// PJ puro — tipo usufruto
// ---------------------------------------------------------------------------

test("pj + usufruto → 1 folha california usufruto", () => {
  const result = decidirFolhasAInserir({
    tipo: "usufruto",
    tipoContratacao: "pj",
    valoresCalifornia: valoresUsufruto,
    baseClt: null,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].origem, "california");
  assert.equal(result[0].tipo_folha_ferias, "usufruto");
  // salario_base = valor_ferias + valor_um_terco = 4000
  assert.equal(result[0].salario_base, "4000.00");
});

// ---------------------------------------------------------------------------
// PJ puro — tipo abono_avulso
// ---------------------------------------------------------------------------

test("pj + abono_avulso → 1 folha california abono", () => {
  const result = decidirFolhasAInserir({
    tipo: "abono_avulso",
    tipoContratacao: "pj",
    valoresCalifornia: valoresAbono,
    baseClt: null,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].origem, "california");
  assert.equal(result[0].tipo_folha_ferias, "abono");
  assert.equal(result[0].salario_base, "1000.00");
});

// ---------------------------------------------------------------------------
// PJ puro — tipo abono_excepcional
// ---------------------------------------------------------------------------

test("pj + abono_excepcional → 1 folha california abono", () => {
  const result = decidirFolhasAInserir({
    tipo: "abono_excepcional",
    tipoContratacao: "pj",
    valoresCalifornia: valoresAbono,
    baseClt: null,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].origem, "california");
  assert.equal(result[0].tipo_folha_ferias, "abono");
  assert.equal(result[0].salario_base, "1000.00");
});

// ---------------------------------------------------------------------------
// PJ puro — tipo abono_combinado → 2 folhas
// ---------------------------------------------------------------------------

test("pj + abono_combinado → 2 folhas california (usufruto + abono)", () => {
  const result = decidirFolhasAInserir({
    tipo: "abono_combinado",
    tipoContratacao: "pj",
    valoresCalifornia: valoresCombinado,
    baseClt: null,
  });

  assert.equal(result.length, 2);

  const usufruto = result.find((r) => r.tipo_folha_ferias === "usufruto");
  const abono = result.find((r) => r.tipo_folha_ferias === "abono");

  assert.ok(usufruto, "deve ter folha usufruto");
  assert.ok(abono, "deve ter folha abono");

  assert.equal(usufruto!.origem, "california");
  // valor_ferias + valor_um_terco = 3000 + 1000 = 4000
  assert.equal(usufruto!.salario_base, "4000.00");

  assert.equal(abono!.origem, "california");
  assert.equal(abono!.salario_base, "1000.00");
});

// ---------------------------------------------------------------------------
// CLT puro — tipo abono_combinado → 2 folhas contabilidade
// ---------------------------------------------------------------------------

test("clt + abono_combinado → 2 folhas contabilidade (usufruto + abono)", () => {
  const result = decidirFolhasAInserir({
    tipo: "abono_combinado",
    tipoContratacao: "clt",
    valoresCalifornia: null,
    baseClt: 5000,
  });

  assert.equal(result.length, 2);

  const usufruto = result.find((r) => r.tipo_folha_ferias === "usufruto");
  const abono = result.find((r) => r.tipo_folha_ferias === "abono");

  assert.ok(usufruto);
  assert.ok(abono);
  assert.equal(usufruto!.origem, "contabilidade");
  assert.equal(abono!.origem, "contabilidade");
});

// ---------------------------------------------------------------------------
// CLT puro — tipo usufruto → 1 folha contabilidade
// ---------------------------------------------------------------------------

test("clt + usufruto → 1 folha contabilidade usufruto", () => {
  const result = decidirFolhasAInserir({
    tipo: "usufruto",
    tipoContratacao: "clt",
    valoresCalifornia: null,
    baseClt: 3000,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].origem, "contabilidade");
  assert.equal(result[0].tipo_folha_ferias, "usufruto");
  assert.equal(result[0].salario_base, "3000.00");
});

// ---------------------------------------------------------------------------
// Idempotência (simulada via decidirFolhasAInserir — a chave é única por output)
// ---------------------------------------------------------------------------

test("abono_combinado retorna tipos distintos (garantia de unicidade de chave)", () => {
  const result = decidirFolhasAInserir({
    tipo: "abono_combinado",
    tipoContratacao: "pj",
    valoresCalifornia: valoresCombinado,
    baseClt: null,
  });

  // Chaves que a função caller usa pra idempotência: `${origem}|${tipo_folha_ferias}`
  const chaves = result.map((r) => `${r.origem}|${r.tipo_folha_ferias}`);
  const unique = new Set(chaves);
  assert.equal(chaves.length, unique.size, "todas as chaves devem ser únicas");
});

// ---------------------------------------------------------------------------
// Valores: usufruto = valor_ferias + valor_um_terco
// ---------------------------------------------------------------------------

test("usufruto salario_base = valor_ferias + valor_um_terco (não valor_total)", () => {
  const result = decidirFolhasAInserir({
    tipo: "usufruto",
    tipoContratacao: "pj",
    valoresCalifornia: { valor_ferias: 2500, valor_um_terco: 833.33, valor_abono: 0, valor_total: 3333.33 },
    baseClt: null,
  });

  assert.equal(result.length, 1);
  // 2500 + 833.33 = 3333.33
  assert.equal(result[0].salario_base, "3333.33");
});

// ---------------------------------------------------------------------------
// Estagiário segue o mesmo fluxo que CLT (baseClt)
// ---------------------------------------------------------------------------

test("estagio + usufruto → 1 folha contabilidade usufruto", () => {
  const result = decidirFolhasAInserir({
    tipo: "usufruto",
    tipoContratacao: "estagio",
    valoresCalifornia: null,
    baseClt: 1500,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].origem, "contabilidade");
  assert.equal(result[0].tipo_folha_ferias, "usufruto");
});
