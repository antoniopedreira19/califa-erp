/**
 * PP fora do cadastro na remessa (decisão 137): só o meio da PP vale, o
 * favorecido continua o do cadastro e a forma vem da PP.
 *
 * Rodar: `npm run test:cnab-fora`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarForaDoCadastroNaRemessa } from "./fora-do-cadastro";
import type { PagamentoForaDoCadastroDaPP } from "@/lib/types";

const cadastro = {
  nome: "Fornecedor Exemplo",
  documento: "34567890000130",
  bancoCodigo: "341",
  agencia: "1234",
  agenciaDv: null,
  conta: "56789",
  contaDv: "0",
  tipoConta: "corrente" as const,
  pixTipo: "cnpj" as const,
  pixChave: "34567890000130",
};

const outroPix: PagamentoForaDoCadastroDaPP = {
  meio: "pix",
  motivo: "Chave temporária enviada pelo fornecedor",
  pix_tipo: "aleatoria",
  pix_chave: "7c1e9a52-3b4d-4f8e-9a61-2d5c8b0e4f13",
  banco_codigo: null,
  banco_nome: null,
  agencia: null,
  agencia_dv: null,
  conta: null,
  conta_dv: null,
  tipo_conta: null,
};

const outraConta: PagamentoForaDoCadastroDaPP = {
  meio: "conta",
  motivo: "Conta da filial informada pelo fornecedor",
  pix_tipo: null,
  pix_chave: null,
  banco_codigo: "001",
  banco_nome: "BANCO DO BRASIL S.A.",
  agencia: "4321",
  agencia_dv: "9",
  conta: "998877",
  conta_dv: "1",
  tipo_conta: "corrente",
};

test("outro PIX: paga na chave da PP, por PIX, e tira a conta do cadastro", () => {
  const { dados, forma } = aplicarForaDoCadastroNaRemessa(cadastro, outroPix);
  assert.equal(forma, "pix");
  assert.equal(dados.pixTipo, "aleatoria");
  assert.equal(dados.pixChave, "7c1e9a52-3b4d-4f8e-9a61-2d5c8b0e4f13");
  assert.equal(dados.bancoCodigo, null);
  assert.equal(dados.conta, null);
  assert.equal(dados.contaDv, null);
});

test("outra conta: paga na conta da PP, por TED, e tira a chave do cadastro", () => {
  const { dados, forma } = aplicarForaDoCadastroNaRemessa(cadastro, outraConta);
  assert.equal(forma, "banco");
  assert.equal(dados.bancoCodigo, "001");
  assert.equal(dados.agencia, "4321");
  assert.equal(dados.agenciaDv, "9");
  assert.equal(dados.conta, "998877");
  assert.equal(dados.contaDv, "1");
  assert.equal(dados.tipoConta, "corrente");
  assert.equal(dados.pixTipo, null);
  assert.equal(dados.pixChave, null);
});

test("o favorecido continua o fornecedor do cadastro", () => {
  for (const fora of [outroPix, outraConta]) {
    const { dados } = aplicarForaDoCadastroNaRemessa(cadastro, fora);
    assert.equal(dados.nome, "Fornecedor Exemplo");
    assert.equal(dados.documento, "34567890000130");
  }
});

test("não altera o objeto do cadastro", () => {
  aplicarForaDoCadastroNaRemessa(cadastro, outroPix);
  assert.equal(cadastro.pixChave, "34567890000130");
  assert.equal(cadastro.conta, "56789");
});
