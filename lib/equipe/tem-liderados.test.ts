import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFlagTemLiderados } from "./tem-liderados";

test("array com pelo menos 1 row → true", () => {
  assert.equal(resolveFlagTemLiderados([{ id: "a" }]), true);
});

test("array vazio → false", () => {
  assert.equal(resolveFlagTemLiderados([]), false);
});

test("null (sem acesso ou RLS bloqueou) → false", () => {
  assert.equal(resolveFlagTemLiderados(null), false);
});
