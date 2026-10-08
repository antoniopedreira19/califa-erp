import { test } from "node:test";
import assert from "node:assert/strict";
import { validarInputLeituraNF } from "./validar-input-ler-nf";

test("validarInputLeituraNF — rejeita mimetype não-PDF", () => {
  const r = validarInputLeituraNF({
    anexo_path: "tenant-1/pps/pp-1/nf.jpg",
    mimetype: "image/jpeg",
    tenantId: "tenant-1",
  });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.message : "", /PDF/i);
});

test("validarInputLeituraNF — rejeita path de outro tenant", () => {
  const r = validarInputLeituraNF({
    anexo_path: "outro-tenant/pps/pp-1/nf.pdf",
    mimetype: "application/pdf",
    tenantId: "tenant-1",
  });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.message : "", /inválido/i);
});

test("validarInputLeituraNF — aceita path do próprio tenant com PDF", () => {
  const r = validarInputLeituraNF({
    anexo_path: "tenant-1/pps/pp-1/nf.pdf",
    mimetype: "application/pdf",
    tenantId: "tenant-1",
  });
  assert.equal(r.ok, true);
});
