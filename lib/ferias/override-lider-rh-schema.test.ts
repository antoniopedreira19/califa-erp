import { test } from "node:test";
import assert from "node:assert/strict";
import { overrideLiderRhSchema } from "./override-lider-rh-schema";

test("uuid válido + sem motivo → sucesso, motivo=null", () => {
  const r = overrideLiderRhSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.motivo, null);
});

test("uuid inválido → fail", () => {
  const r = overrideLiderRhSchema.safeParse({ lancamentoId: "nao-uuid" });
  assert.equal(r.success, false);
});

test("motivo só de espaços → sucesso com motivo=null", () => {
  const r = overrideLiderRhSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
    motivo: "   ",
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.motivo, null);
});

test("motivo com texto → sucesso com motivo trimado", () => {
  const r = overrideLiderRhSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
    motivo: "  líder viajou ",
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.motivo, "líder viajou");
});

test("motivo com 501 chars → fail", () => {
  const r = overrideLiderRhSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
    motivo: "a".repeat(501),
  });
  assert.equal(r.success, false);
});
