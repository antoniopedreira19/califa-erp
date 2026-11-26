import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validarPeriodoEditado,
  type AquisitivoParaValidar,
} from "./validar-periodo-editado";

function aquisitivo(
  partial: Partial<AquisitivoParaValidar> = {},
): AquisitivoParaValidar {
  return {
    id: "aq-1",
    aquisitivo_inicio: "2026-01-01",
    data_limite_gozo: "2027-12-31",
    dias_direito: 30,
    dias_ocupados_outros: 0,
    ...partial,
  };
}

test("data_fim < data_inicio → rejeita", () => {
  const r = validarPeriodoEditado({
    data_inicio: "2026-12-10",
    data_fim: "2026-12-05",
    aquisitivo: null,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /antes da data de início/);
});

test("happy path sem aquisitivo (abono avulso) → ok com dias correto", () => {
  const r = validarPeriodoEditado({
    data_inicio: "2026-12-01",
    data_fim: "2026-12-05",
    aquisitivo: null,
  });
  assert.deepEqual(r, { ok: true, dias: 5 });
});

test("1 dia → dias=1", () => {
  const r = validarPeriodoEditado({
    data_inicio: "2026-12-01",
    data_fim: "2026-12-01",
    aquisitivo: null,
  });
  assert.deepEqual(r, { ok: true, dias: 1 });
});

test("data_inicio antes do aquisitivo_inicio → rejeita", () => {
  const r = validarPeriodoEditado({
    data_inicio: "2025-12-01",
    data_fim: "2025-12-05",
    aquisitivo: aquisitivo({ aquisitivo_inicio: "2026-01-01" }),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /fora do aquisitivo/);
});

test("data_inicio depois do data_limite_gozo → rejeita", () => {
  const r = validarPeriodoEditado({
    data_inicio: "2028-01-05",
    data_fim: "2028-01-10",
    aquisitivo: aquisitivo({ data_limite_gozo: "2027-12-31" }),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /fora do aquisitivo/);
});

test("dias excede saldo do aquisitivo → rejeita", () => {
  const r = validarPeriodoEditado({
    data_inicio: "2026-12-01",
    data_fim: "2026-12-31",
    aquisitivo: aquisitivo({ dias_direito: 10, dias_ocupados_outros: 0 }),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /saldo/);
});

test("dias == saldo exato → ok", () => {
  const r = validarPeriodoEditado({
    data_inicio: "2026-12-01",
    data_fim: "2026-12-10",
    aquisitivo: aquisitivo({ dias_direito: 10, dias_ocupados_outros: 0 }),
  });
  assert.deepEqual(r, { ok: true, dias: 10 });
});

test("ampliar dias no mesmo aquisitivo — dias_ocupados_outros exclui o próprio → ok", () => {
  // Cenário: lançamento de 5 dias no aquisitivo com 30 dias de direito.
  // Outro lançamento do colaborador ocupa 10 dias. O próprio lançamento
  // NÃO deve entrar em dias_ocupados_outros (a action filtra por id).
  // RH amplia de 5 para 20 dias → ok (20 <= 30 - 10 = 20).
  const r = validarPeriodoEditado({
    data_inicio: "2026-12-01",
    data_fim: "2026-12-20",
    aquisitivo: aquisitivo({ dias_direito: 30, dias_ocupados_outros: 10 }),
  });
  assert.deepEqual(r, { ok: true, dias: 20 });
});
