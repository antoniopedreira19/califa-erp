/**
 * A trava do cadastro do fornecedor na PP (decisão 255, amplia a 166).
 * Rodar: node --import tsx --test lib/cadastro-do-fornecedor-na-pp.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dicaCnpjEhPix,
  mensagemCadastroIncompleto,
  pendenciasDoCadastroNaPP,
  temContaOuPix,
  type CadastroParaPP,
} from "./cadastro-do-fornecedor-na-pp";
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

// Decisão 283 — dica "o CNPJ é a chave PIX" na mensagem de cadastro incompleto.

test("dica CNPJ-vira-PIX: PJ com CNPJ válido e 'a conta ou o PIX' pendente", () => {
  const cad: CadastroParaPP = {
    ...DA_PLANILHA_PJ,
    cpf_cnpj: "11.222.333/0001-81",
  };
  const pendencias = ["o e-mail", "a conta ou o PIX"];
  const dica = dicaCnpjEhPix(cad, pendencias);
  assert.ok(dica && dica.includes("CNPJ"), `esperava a dica, veio "${dica ?? "null"}"`);
});

test("dica CNPJ-vira-PIX: PF nunca recebe a dica (não existe PIX CNPJ em PF)", () => {
  const cad: CadastroParaPP = {
    ...DA_PLANILHA_PJ,
    tipo_pessoa: "fisica",
    cpf_cnpj: "11122233344",
  };
  assert.equal(dicaCnpjEhPix(cad, ["a conta ou o PIX"]), null);
});

test("dica CNPJ-vira-PIX: sem 'a conta ou o PIX' nas pendências, não sugere", () => {
  const cad: CadastroParaPP = { ...DA_PLANILHA_PJ, cpf_cnpj: "11222333000181" };
  assert.equal(dicaCnpjEhPix(cad, ["o e-mail", "o telefone"]), null);
});

test("dica CNPJ-vira-PIX: sem CNPJ válido, não sugere", () => {
  const cad: CadastroParaPP = { ...DA_PLANILHA_PJ, cpf_cnpj: "" };
  assert.equal(dicaCnpjEhPix(cad, ["a conta ou o PIX"]), null);
});

test("mensagemCadastroIncompleto: junta cabeçalho, caminho e dica", () => {
  const cad = {
    ...DA_PLANILHA_PJ,
    nome: "FORNECEDOR NNN EXEMPLO",
    cpf_cnpj: "11222333000181",
  };
  const msg = mensagemCadastroIncompleto(
    cad,
    ["o e-mail", "o telefone", "a conta ou o PIX"],
    "lapis_edicao",
  );
  assert.ok(msg.startsWith("O cadastro de FORNECEDOR NNN EXEMPLO está incompleto: falta "));
  assert.ok(msg.includes("Clique em Editar"));
  assert.ok(msg.includes("CNPJ"));
});

test("mensagemCadastroIncompleto: sem dica quando a lista não tem 'a conta ou o PIX'", () => {
  const cad = {
    ...DA_PLANILHA_PJ,
    nome: "FORNECEDOR NNN EXEMPLO",
    cpf_cnpj: "11222333000181",
  };
  const msg = mensagemCadastroIncompleto(cad, ["o e-mail"], "peca_ao_financeiro");
  assert.ok(!msg.includes("CNPJ"));
  assert.ok(msg.includes("Peça ao financeiro"));
});
