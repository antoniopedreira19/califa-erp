import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aprovarComoLiderSchema,
  reprovarComoLiderSchema,
} from "./aprovar-como-lider-schema";

test("aprovar: uuid válido → sucesso", () => {
  const r = aprovarComoLiderSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
  });
  assert.equal(r.success, true);
});

test("aprovar: uuid inválido → fail", () => {
  const r = aprovarComoLiderSchema.safeParse({ lancamentoId: "nao-uuid" });
  assert.equal(r.success, false);
});

test("reprovar: motivo com 3 chars após trim → sucesso", () => {
  const r = reprovarComoLiderSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
    motivo: "  oki ",
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.motivo, "oki");
});

test("reprovar: motivo só com espaços → fail", () => {
  const r = reprovarComoLiderSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
    motivo: "   ",
  });
  assert.equal(r.success, false);
});

test("reprovar: motivo com 2 chars após trim → fail (min 3)", () => {
  const r = reprovarComoLiderSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
    motivo: "ok",
  });
  assert.equal(r.success, false);
});
