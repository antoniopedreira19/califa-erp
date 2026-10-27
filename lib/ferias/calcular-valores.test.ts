import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularValoresLancamento } from "./calcular-valores";

const SALARIO = 3000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

test("usufruto: 20 dias", async () => {
  const v = await calcularValoresLancamento(
    "x",
    "2027-01-01",
    "usufruto",
    20,
    0,
    SALARIO,
  );
  assert.equal(v?.valor_ferias, 2000);
  assert.equal(v?.valor_abono, 0);
  assert.equal(v?.valor_um_terco, round2(2000 / 3));
  assert.equal(v?.valor_total, round2(2000 + 0 + 2000 / 3));
});

test("abono_avulso: 10 dias", async () => {
  const v = await calcularValoresLancamento(
    "x",
    "2027-01-01",
    "abono_avulso",
    10,
    0,
    SALARIO,
  );
  assert.equal(v?.valor_ferias, 0);
  assert.equal(v?.valor_abono, 1000);
  assert.equal(v?.valor_um_terco, round2(1000 / 3));
});

test("abono_combinado: 20 folga + 10 abono = 30 dias", async () => {
  const v = await calcularValoresLancamento(
    "x",
    "2027-01-01",
    "abono_combinado",
    30,
    10,
    SALARIO,
  );
  // dias_folga = 30 - 10 = 20
  assert.equal(v?.valor_ferias, 2000); // diario × dias_folga
  assert.equal(v?.valor_abono, 1000); // diario × dias_abono
  assert.equal(v?.valor_um_terco, round2(2000 / 3)); // só sobre valor_ferias (CLT)
  assert.equal(v?.valor_total, round2(2000 + 1000 + 2000 / 3));
});

test("abono_excepcional: 15 dias", async () => {
  const v = await calcularValoresLancamento(
    "x",
    "2027-01-01",
    "abono_excepcional",
    15,
    0,
    SALARIO,
  );
  assert.equal(v?.valor_ferias, 0);
  assert.equal(v?.valor_abono, 1500);
  assert.equal(v?.valor_um_terco, round2(1500 / 3));
});

test("retorna null quando salario inválido", async () => {
  const v = await calcularValoresLancamento(
    "x",
    "2027-01-01",
    "usufruto",
    10,
    0,
    0,
  );
  assert.equal(v, null);
});
