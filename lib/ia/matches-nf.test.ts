import { test } from "node:test";
import assert from "node:assert/strict";
import { acharEstabelecimentoPorCnpj, acharFornecedorPorCnpj } from "./matches-nf";

test("acharEstabelecimentoPorCnpj — match com CNPJ formatado no lado dos tomadores", () => {
  const tomadores = [
    { id: "emp-1", cnpj: "19.437.976/0001-54" },
    { id: "emp-2", cnpj: "22.222.222/0001-22" },
  ];
  assert.equal(acharEstabelecimentoPorCnpj("19437976000154", tomadores), "emp-1");
});

test("acharEstabelecimentoPorCnpj — null se CNPJ não bate", () => {
  const tomadores = [{ id: "emp-1", cnpj: "19.437.976/0001-54" }];
  assert.equal(acharEstabelecimentoPorCnpj("33333333333333", tomadores), null);
});

test("acharEstabelecimentoPorCnpj — null se lista vazia", () => {
  assert.equal(acharEstabelecimentoPorCnpj("19437976000154", []), null);
});

test("acharFornecedorPorCnpj — match em fornecedor PJ formatado", () => {
  const fornecedores = [
    { id: "forn-1", cpf_cnpj: "11.222.333/0001-44" },
    { id: "forn-2", cpf_cnpj: "55.666.777/0001-88" },
  ];
  assert.equal(acharFornecedorPorCnpj("11222333000144", fornecedores), "forn-1");
});

test("acharFornecedorPorCnpj — ignora fornecedor PF (CPF 11 dígitos)", () => {
  const fornecedores = [
    { id: "pf-1", cpf_cnpj: "123.456.789-00" }, // CPF
    { id: "pj-1", cpf_cnpj: "11.222.333/0001-44" },
  ];
  // CNPJ emissor da NF nunca vai bater com CPF.
  assert.equal(acharFornecedorPorCnpj("11222333000144", fornecedores), "pj-1");
});

test("acharFornecedorPorCnpj — null se cpf_cnpj faltando ou nulo", () => {
  const fornecedores = [
    { id: "forn-1", cpf_cnpj: null },
    { id: "forn-2" },
  ];
  assert.equal(acharFornecedorPorCnpj("11222333000144", fornecedores), null);
});

test("acharFornecedorPorCnpj — null se CNPJ não bate", () => {
  const fornecedores = [{ id: "forn-1", cpf_cnpj: "11.222.333/0001-44" }];
  assert.equal(acharFornecedorPorCnpj("99888777000166", fornecedores), null);
});
