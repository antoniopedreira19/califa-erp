/**
 * Testes do que o pop-up de aprovação manda da NF do fornecedor (módulo
 * fiscal, 02/10/2026). Rodar: node --import tsx --test lib/validations/nf-da-pp.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nfDaPPSchema } from "./nf-da-pp";

const NF = {
  numero: " 602 ",
  data_emissao: "2026-09-28",
  valor: 18000,
  tomador_estabelecimento_id: "ebfdae66-8644-4f9f-9079-fcf92ca18102",
  retencoes: [
    { imposto: "PIS", aliquota: 0.65 },
    { imposto: "COFINS", aliquota: 3 },
    { imposto: "CSLL", aliquota: 1 },
    { imposto: "IRRF", aliquota: 1.5 },
  ],
  credito_retirado: false,
  credito_motivo: null,
};

const erro = (x: unknown) => {
  const r = nfDaPPSchema.safeParse(x);
  return r.success ? null : r.error.issues[0]?.message;
};

test("a NF completa passa, com o número aparado", () => {
  const r = nfDaPPSchema.safeParse(NF);
  assert.ok(r.success);
  assert.equal(r.data.numero, "602");
  assert.equal(r.data.retencoes.length, 4);
});

test("sem retenção e sem crédito informados, os padrões valem", () => {
  const { retencoes: _r, credito_retirado: _c, credito_motivo: _m, ...so } = NF;
  const r = nfDaPPSchema.safeParse(so);
  assert.ok(r.success);
  assert.deepEqual(r.data.retencoes, []);
  assert.equal(r.data.credito_retirado, false);
  assert.equal(r.data.credito_motivo, null);
});

test("as mensagens saem em português", () => {
  assert.equal(erro(undefined), "Preencha a nota fiscal do fornecedor em “Dados da PP” antes de aprovar.");
  assert.equal(erro({ ...NF, numero: "  " }), "Informe o número da NF.");
  assert.equal(erro({ ...NF, numero: undefined }), "Informe o número da NF.");
  assert.equal(erro({ ...NF, data_emissao: "" }), "Informe a data de emissão da NF.");
  assert.equal(erro({ ...NF, valor: 0 }), "Informe o valor da NF.");
  assert.equal(erro({ ...NF, valor: "18000" }), "Informe o valor da NF.");
  assert.equal(erro({ ...NF, tomador_estabelecimento_id: "" }), "Escolha o CNPJ tomador da NF.");
  assert.equal(erro({ ...NF, retencoes: [{ imposto: "INSS", aliquota: 11 }] }), "Imposto retido inválido.");
  assert.equal(erro({ ...NF, retencoes: [{ imposto: "PIS", aliquota: 0 }] }), "Alíquota de retenção inválida.");
  assert.equal(erro({ ...NF, retencoes: [{ imposto: "PIS", aliquota: 100 }] }), "Alíquota de retenção inválida.");
  assert.equal(
    erro({ ...NF, retencoes: [{ imposto: "PIS", aliquota: 0.65 }, { imposto: "PIS", aliquota: 1 }] }),
    "Cada imposto retido entra uma vez só.",
  );
});

test("tirar o crédito pede um motivo da lista", () => {
  assert.equal(
    erro({ ...NF, credito_retirado: true, credito_motivo: null }),
    "Escolha o motivo de a nota não gerar crédito de PIS/COFINS.",
  );
  assert.equal(
    erro({ ...NF, credito_retirado: true, credito_motivo: "Qualquer coisa" }),
    "Escolha o motivo de a nota não gerar crédito de PIS/COFINS.",
  );
  assert.equal(erro({ ...NF, credito_retirado: true, credito_motivo: "Outro" }), null);
  assert.equal(
    erro({ ...NF, credito_retirado: true, credito_motivo: "Reembolso de despesa do cliente" }),
    null,
  );
});
