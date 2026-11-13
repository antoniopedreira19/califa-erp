/**
 * A trava do cadastro do fornecedor na PP (decisão 255, amplia a 166).
 * Rodar: node --import tsx --test lib/cadastro-do-fornecedor-na-pp.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pendenciasDoCadastroNaPP, temContaOuPix, type CadastroParaPP } from "./cadastro-do-fornecedor-na-pp";
import { listarPendencias } from "./fiscal/regime-do-fornecedor";

const PJ_COMPLETA: CadastroParaPP = {
  tipo_pessoa: "juridica",
  regime_tributario: "simples",
  cnae: "5911102",
  email: "pessoal_001@exemplo.com",
  telefone: "00000000000",
  banco_codigo: null,
  pix_tipo: "cnpj",
  pix_chave: "11222333000181",
  sem_dados_pagamento: false,
};

const PF_COMPLETA: CadastroParaPP = {
  tipo_pessoa: "fisica",
  regime_tributario: null,
  cnae: null,
  email: "pessoal_002@exemplo.com",
  telefone: "00000000000",
  banco_codigo: "341",
  pix_tipo: null,
  pix_chave: null,
  sem_dados_pagamento: false,
};

/** Como a carga da planilha grava: só nome e documento. */
const DA_PLANILHA_PJ: CadastroParaPP = {
  tipo_pessoa: "juridica",
  regime_tributario: null,
  cnae: null,
  email: null,
  telefone: null,
  banco_codigo: null,
  pix_tipo: null,
  pix_chave: null,
  sem_dados_pagamento: false,
};

test("cadastro completo não trava, pagando pelo cadastro ou não", () => {
  assert.deepEqual(pendenciasDoCadastroNaPP(PJ_COMPLETA, { pagaPeloCadastro: true }), []);
  assert.deepEqual(pendenciasDoCadastroNaPP(PJ_COMPLETA, { pagaPeloCadastro: false }), []);
  assert.deepEqual(pendenciasDoCadastroNaPP(PF_COMPLETA, { pagaPeloCadastro: true }), []);
});

test("PJ da planilha: tudo falta pelo cadastro; com boleto, a conta sai da lista", () => {
  assert.deepEqual(pendenciasDoCadastroNaPP(DA_PLANILHA_PJ, { pagaPeloCadastro: true }), [
    "o e-mail",
    "o telefone",
    "a conta ou o PIX",
    "o regime tributário",
    "o CNAE",
  ]);
  assert.deepEqual(pendenciasDoCadastroNaPP(DA_PLANILHA_PJ, { pagaPeloCadastro: false }), [
    "o e-mail",
    "o telefone",
    "o regime tributário",
    "o CNAE",
  ]);
});

test("PF da planilha trava pelo e-mail, telefone e conta — nunca por regime e CNAE", () => {
  const pf = { ...DA_PLANILHA_PJ, tipo_pessoa: "fisica" };
  assert.deepEqual(pendenciasDoCadastroNaPP(pf, { pagaPeloCadastro: true }), [
    "o e-mail",
    "o telefone",
    "a conta ou o PIX",
  ]);
  assert.deepEqual(pendenciasDoCadastroNaPP(pf, { pagaPeloCadastro: false }), ["o e-mail", "o telefone"]);
});

test("e-mail e telefone em branco contam como faltando", () => {
  assert.deepEqual(
    pendenciasDoCadastroNaPP({ ...PF_COMPLETA, email: "  ", telefone: "" }, { pagaPeloCadastro: false }),
    ["o e-mail", "o telefone"],
  );
});

test("“Sem conta nem PIX” não pede conta: a PP já exige chave, boleto ou guia", () => {
  const semDados = { ...PF_COMPLETA, banco_codigo: null, sem_dados_pagamento: true };
  assert.deepEqual(pendenciasDoCadastroNaPP(semDados, { pagaPeloCadastro: true }), []);
});

test("PIX pela metade não conta como meio de pagamento", () => {
  assert.equal(temContaOuPix({ ...PF_COMPLETA, banco_codigo: null, pix_tipo: "email", pix_chave: null }), false);
  assert.equal(temContaOuPix({ ...PF_COMPLETA, banco_codigo: null, pix_tipo: "email", pix_chave: "pessoal_003@exemplo.com" }), true);
});

test("sem cadastro não há o que cobrar", () => {
  assert.deepEqual(pendenciasDoCadastroNaPP(null, { pagaPeloCadastro: true }), []);
});

test("a mensagem lista na ordem do formulário", () => {
  assert.equal(
    listarPendencias(pendenciasDoCadastroNaPP(DA_PLANILHA_PJ, { pagaPeloCadastro: false })),
    "o e-mail, o telefone, o regime tributário e o CNAE",
  );
});
