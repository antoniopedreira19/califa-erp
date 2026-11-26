import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirCancelamento } from "./decidir-cancelamento";

test("aguardando_gestor → ok, sem apagar folhas", () => {
  assert.deepEqual(decidirCancelamento("aguardando_gestor"), {
    ok: true,
    deve_apagar_folhas_rascunho: false,
    idempotente: false,
  });
});

test("pendente_aprovacao → ok, sem apagar folhas", () => {
  assert.deepEqual(decidirCancelamento("pendente_aprovacao"), {
    ok: true,
    deve_apagar_folhas_rascunho: false,
    idempotente: false,
  });
});

test("aprovado → ok, apaga folhas rascunho", () => {
  assert.deepEqual(decidirCancelamento("aprovado"), {
    ok: true,
    deve_apagar_folhas_rascunho: true,
    idempotente: false,
  });
});

test("nf_anexada → ok, apaga folhas rascunho", () => {
  assert.deepEqual(decidirCancelamento("nf_anexada"), {
    ok: true,
    deve_apagar_folhas_rascunho: true,
    idempotente: false,
  });
});

test("enviado_financeiro → rejeita com mensagem de financeiro", () => {
  const r = decidirCancelamento("enviado_financeiro");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /financeiro/);
});

test("concluido → rejeita", () => {
  const r = decidirCancelamento("concluido");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /concluída/);
});

test("cancelado → ok idempotente", () => {
  assert.deepEqual(decidirCancelamento("cancelado"), {
    ok: true,
    deve_apagar_folhas_rascunho: false,
    idempotente: true,
  });
});

test("reprovado → ok idempotente (dado legado)", () => {
  assert.deepEqual(decidirCancelamento("reprovado"), {
    ok: true,
    deve_apagar_folhas_rascunho: false,
    idempotente: true,
  });
});

test("aguardando_financeiro → rejeita", () => {
  const r = decidirCancelamento("aguardando_financeiro");
  assert.equal(r.ok, false);
});
