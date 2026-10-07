/**
 * Testes do que o pop-up de aprovação manda das NFs do fornecedor (módulo
 * fiscal, 02/10/2026; decisão 152, 07/10/2026).
 * Rodar: node --import tsx --test lib/validations/nf-da-pp.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { notasDaPPSchema } from "./nf-da-pp";

const NOTA = {
  anexo_id: "0b7d7c4e-7d6a-4f0e-9e1a-2a9d9c3b5a10",
  numero: " 602 ",
  data_emissao: "2026-09-28",
  valor: 18000,
  tomador_estabelecimento_id: "ebfdae66-8644-4f9f-9079-fcf92ca18102",
  valor_na_pp: 18000,
  credito_retirado: false,
  credito_motivo: null,
};

const NOTAS = {
  notas: [NOTA],
  retencoes: [
    { imposto: "PIS", aliquota: 0.65 },
    { imposto: "COFINS", aliquota: 3 },
    { imposto: "CSLL", aliquota: 1 },
    { imposto: "IRRF", aliquota: 1.5 },
  ],
};

const comNota = (n: Record<string, unknown>) => ({ ...NOTAS, notas: [{ ...NOTA, ...n }] });

const erro = (x: unknown) => {
  const r = notasDaPPSchema.safeParse(x);
  return r.success ? null : r.error.issues[0]?.message;
};

test("as notas completas passam, com o número aparado", () => {
  const r = notasDaPPSchema.safeParse(NOTAS);
  assert.ok(r.success);
  assert.equal(r.data.notas[0].numero, "602");
  assert.equal(r.data.retencoes.length, 4);
});

test("sem retenção e sem crédito informados, os padrões valem", () => {
  const { credito_retirado: _c, credito_motivo: _m, ...nota } = NOTA;
  const r = notasDaPPSchema.safeParse({ notas: [nota] });
  assert.ok(r.success);
  assert.deepEqual(r.data.retencoes, []);
  assert.equal(r.data.notas[0].credito_retirado, false);
  assert.equal(r.data.notas[0].credito_motivo, null);
});

test("as mensagens saem em português", () => {
  assert.equal(erro(undefined), "Preencha as notas fiscais do fornecedor em “Dados da PP” antes de aprovar.");
  assert.equal(erro({ notas: [] }), "Preencha as notas fiscais do fornecedor em “Dados da PP” antes de aprovar.");
  assert.equal(erro(comNota({ numero: "  " })), "Informe o número da NF.");
  assert.equal(erro(comNota({ numero: undefined })), "Informe o número da NF.");
  assert.equal(erro(comNota({ data_emissao: "" })), "Informe a data de emissão da NF.");
  assert.equal(erro(comNota({ valor: 0 })), "Informe o valor da NF.");
  assert.equal(erro(comNota({ valor: "18000" })), "Informe o valor da NF.");
  assert.equal(erro(comNota({ tomador_estabelecimento_id: "" })), "Escolha o CNPJ tomador da NF.");
  assert.equal(erro(comNota({ valor_na_pp: 0 })), "Informe o valor da NF nesta PP.");
  assert.equal(erro({ ...NOTAS, retencoes: [{ imposto: "INSS", aliquota: 11 }] }), "Imposto retido inválido.");
  assert.equal(erro({ ...NOTAS, retencoes: [{ imposto: "PIS", aliquota: 0 }] }), "Alíquota de retenção inválida.");
  assert.equal(erro({ ...NOTAS, retencoes: [{ imposto: "PIS", aliquota: 100 }] }), "Alíquota de retenção inválida.");
  assert.equal(
    erro({ ...NOTAS, retencoes: [{ imposto: "PIS", aliquota: 0.65 }, { imposto: "PIS", aliquota: 1 }] }),
    "Cada imposto retido entra uma vez só.",
  );
});

test("a parte da nota nesta PP não passa do valor da nota (decisão 152)", () => {
  assert.equal(erro(comNota({ valor: 10000, valor_na_pp: 6000 })), null);
  assert.equal(
    erro(comNota({ valor: 10000, valor_na_pp: 10000.01 })),
    "O valor da NF 602 nesta PP não pode passar do valor da nota.",
  );
});

test("o mesmo anexo não vem duas vezes", () => {
  assert.equal(
    erro({ ...NOTAS, notas: [NOTA, { ...NOTA, numero: "603" }] }),
    "As notas não batem com os anexos da PP. Recarregue a tela.",
  );
});

test("tirar o crédito pede um motivo da lista", () => {
  assert.equal(
    erro(comNota({ credito_retirado: true, credito_motivo: null })),
    "Escolha o motivo de a nota não gerar crédito de PIS/COFINS.",
  );
  assert.equal(
    erro(comNota({ credito_retirado: true, credito_motivo: "Qualquer coisa" })),
    "Escolha o motivo de a nota não gerar crédito de PIS/COFINS.",
  );
  assert.equal(erro(comNota({ credito_retirado: true, credito_motivo: "Outro" })), null);
  assert.equal(erro(comNota({ credito_retirado: true, credito_motivo: "Reembolso de despesa do cliente" })), null);
});
