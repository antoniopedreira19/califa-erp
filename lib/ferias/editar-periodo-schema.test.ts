import { test } from "node:test";
import assert from "node:assert/strict";
import { editarPeriodoSchema } from "./editar-periodo-schema";

const UUID = "11111111-1111-4111-a111-111111111111";

test("happy path parse", () => {
  const r = editarPeriodoSchema.safeParse({
    lancamento_id: UUID,
    data_inicio: "2026-12-01",
    data_fim: "2026-12-10",
    periodo_id: UUID,
  });
  assert.equal(r.success, true);
});

test("data_inicio formato errado falha", () => {
  const r = editarPeriodoSchema.safeParse({
    lancamento_id: UUID,
    data_inicio: "01/12/2026",
    data_fim: "2026-12-10",
    periodo_id: null,
  });
  assert.equal(r.success, false);
});

test("lancamento_id não-uuid falha", () => {
  const r = editarPeriodoSchema.safeParse({
    lancamento_id: "nao-uuid",
    data_inicio: "2026-12-01",
    data_fim: "2026-12-10",
    periodo_id: null,
  });
  assert.equal(r.success, false);
});

test("periodo_id null passa", () => {
  const r = editarPeriodoSchema.safeParse({
    lancamento_id: UUID,
    data_inicio: "2026-12-01",
    data_fim: "2026-12-10",
    periodo_id: null,
  });
  assert.equal(r.success, true);
});
