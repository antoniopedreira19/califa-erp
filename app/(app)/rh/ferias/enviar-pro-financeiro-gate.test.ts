import { test } from "node:test";
import assert from "node:assert/strict";
import { dataPagamentoSchema } from "@/lib/ferias/enviar-pro-financeiro-schema";

test("YYYY-MM-DD válida passa", () => {
  assert.equal(dataPagamentoSchema.safeParse("2026-12-20").success, true);
});

test("formato errado falha", () => {
  assert.equal(dataPagamentoSchema.safeParse("20/12/2026").success, false);
});

test("undefined passa (opcional)", () => {
  assert.equal(dataPagamentoSchema.safeParse(undefined).success, true);
});
