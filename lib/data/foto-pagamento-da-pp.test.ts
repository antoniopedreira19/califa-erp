/**
 * Pagamento fora do cadastro (decisão 127): a foto troca SÓ o meio
 * escolhido, o asterisco da 067 ignora esse meio, e o schema grava a chave
 * no formato da remessa. Decisão 161: só chave aleatória ou boleto, sem
 * motivo; o boleto mantém o cadastro na foto e não acende o asterisco.
 *
 * Rodar: `npm run test:foto-pp`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aplicarPagamentoForaDoCadastro,
  cadastroMudouDepoisDaFoto,
  fotoDoPagamentoDoTitular,
  lerPagamentoForaDoCadastro,
  pagamentoDoTitularDaFoto,
  pagamentoDoTitularDaPP,
  resumoDoCadastroDePagamento,
  tirarFoto,
  type DadosDePagamento,
} from "./foto-pagamento-da-pp";
import { pagamentoForaDoCadastroSchema } from "../validations/pagamento-fora-do-cadastro";
import { pagamentoDoTitularSchema } from "../validations/pagamento-do-titular";

const cadastro: DadosDePagamento = {
  banco_codigo: "341",
  banco_nome: "ITAÚ UNIBANCO S.A.",
  agencia: "1234",
  agencia_dv: null,
  conta: "56789",
  conta_dv: "0",
  tipo_conta: "corrente",
  pix_tipo: "cnpj",
  pix_chave: "11222333000181",
};

test("outro PIX troca só a chave e mantém a conta do cadastro", () => {
  const r = aplicarPagamentoForaDoCadastro(cadastro, {
    meio: "pix",
    motivo: "Chave temporária do fornecedor",
    pix_tipo: "aleatoria",
    pix_chave: "7c1e9a52-3b4d-4f8e-9a61-2d5c8b0e4f13",
    banco_codigo: null,
    agencia: null,
    agencia_dv: null,
    conta: null,
    conta_dv: null,
    tipo_conta: null,
  });
  assert.equal(r.pix_tipo, "aleatoria");
  assert.equal(r.pix_chave, "7c1e9a52-3b4d-4f8e-9a61-2d5c8b0e4f13");
  assert.equal(r.banco_codigo, "341");
  assert.equal(r.conta, "56789");
});

test("outra conta troca só a conta, com o nome do banco, e mantém a chave", () => {
  const r = aplicarPagamentoForaDoCadastro(cadastro, {
    meio: "conta",
    motivo: "Conta nova do fornecedor para este job",
    pix_tipo: null,
    pix_chave: null,
    banco_codigo: "237",
    agencia: "0456",
    agencia_dv: "7",
    conta: "0012345",
    conta_dv: "6",
    tipo_conta: "corrente",
  });
  assert.equal(r.banco_codigo, "237");
  assert.equal(r.banco_nome, "Banco Bradesco S.A.");
  assert.equal(r.agencia_dv, "7");
  assert.equal(r.pix_chave, "11222333000181");
});

test("sem pagamento fora do cadastro, a foto é o cadastro", () => {
  const foto = tirarFoto(cadastro, null);
  assert.equal(foto.fornecedor_pix_chave, "11222333000181");
  assert.equal(foto.fornecedor_conta, "56789");
});

test("o asterisco ignora o meio trocado e continua olhando o outro", () => {
  const fora = {
    meio: "pix" as const,
    motivo: "Chave temporária do fornecedor",
    pix_tipo: "aleatoria" as const,
    pix_chave: "7c1e9a52-3b4d-4f8e-9a61-2d5c8b0e4f13",
    banco_codigo: null,
    agencia: null,
    agencia_dv: null,
    conta: null,
    conta_dv: null,
    tipo_conta: null,
  };
  const pp = {
    ...tirarFoto(cadastro, fora),
    dados_pagamento_congelados_em: "2026-09-29T10:00:00Z",
    status: "em_avaliacao",
    pagamento_fora_do_cadastro_meio: "pix",
  };
  assert.equal(cadastroMudouDepoisDaFoto(pp, cadastro), false);
  assert.equal(cadastroMudouDepoisDaFoto(pp, { ...cadastro, conta: "99999" }), true);
  assert.equal(cadastroMudouDepoisDaFoto(pp, { ...cadastro, pix_chave: "12345678000199" }), false);
});

test("a leitura devolve só o meio trocado", () => {
  const pp = {
    ...tirarFoto(cadastro, {
      meio: "pix",
      motivo: "Chave temporária do fornecedor",
      pix_tipo: "email",
      pix_chave: "pagamentos@fornecedor.com.br",
      banco_codigo: null,
      agencia: null,
      agencia_dv: null,
      conta: null,
      conta_dv: null,
      tipo_conta: null,
    }),
    pagamento_fora_do_cadastro_meio: "pix",
    pagamento_fora_do_cadastro_motivo: "Chave temporária do fornecedor",
  };
  const lido = lerPagamentoForaDoCadastro(pp);
  assert.equal(lido?.pix_chave, "pagamentos@fornecedor.com.br");
  assert.equal(lido?.conta, null);
  assert.equal(lerPagamentoForaDoCadastro({ ...pp, pagamento_fora_do_cadastro_meio: null }), null);
});

test("o schema grava a chave no formato da remessa e zera o outro meio", () => {
  const evp = pagamentoForaDoCadastroSchema.parse({
    meio: "pix",
    motivo: "Chave temporária do fornecedor",
    pix_tipo: "aleatoria",
    pix_chave: "7C1E9A523B4D4F8E9A612D5C8B0E4F13",
    banco_codigo: "341",
    conta: "123",
  });
  assert.equal(evp.pix_chave, "7c1e9a52-3b4d-4f8e-9a61-2d5c8b0e4f13");
  assert.equal(evp.banco_codigo, null);

  // Decisão 161: sem motivo — o que vier é descartado.
  assert.equal(evp.motivo, null);
});

test("o schema aceita o boleto sem dado nenhum (decisão 161)", () => {
  const boleto = pagamentoForaDoCadastroSchema.parse({ meio: "boleto" });
  assert.equal(boleto.meio, "boleto");
  assert.equal(boleto.motivo, null);
  assert.equal(boleto.pix_tipo, null);
  assert.equal(boleto.pix_chave, null);
  assert.equal(boleto.banco_codigo, null);
});

test("o schema recusa chave que não é aleatória, chave torta e outra conta", () => {
  const cnpj = pagamentoForaDoCadastroSchema.safeParse({
    meio: "pix",
    pix_tipo: "cnpj",
    pix_chave: "11222333000181",
  });
  assert.equal(cnpj.success, false);

  const torta = pagamentoForaDoCadastroSchema.safeParse({
    meio: "pix",
    motivo: "Chave temporária do fornecedor",
    pix_tipo: "aleatoria",
    pix_chave: "7c1e9a52",
  });
  assert.equal(torta.success, false);

  const conta = pagamentoForaDoCadastroSchema.safeParse({
    meio: "conta",
    motivo: "Conta nova do fornecedor para este job",
    banco_codigo: "237",
    agencia: "0456",
    conta: "0012345",
  });
  assert.equal(conta.success, false);
});

test("boleto mantém o cadastro na foto e não acende o asterisco (decisão 161)", () => {
  const boleto = pagamentoForaDoCadastroSchema.parse({ meio: "boleto" });
  assert.deepEqual(aplicarPagamentoForaDoCadastro(cadastro, boleto), cadastro);
  const pp = {
    ...tirarFoto(cadastro, boleto),
    dados_pagamento_congelados_em: "2026-10-09T10:00:00Z",
    status: "em_avaliacao",
    pagamento_fora_do_cadastro_meio: "boleto",
    pagamento_fora_do_cadastro_motivo: null,
  };
  // O cadastro inteiro mudou depois: no boleto, nada dele é pagamento.
  assert.equal(
    cadastroMudouDepoisDaFoto(pp, { ...cadastro, conta: "99999", pix_chave: "11222333000181" }),
    false,
  );
  const lido = lerPagamentoForaDoCadastro(pp);
  assert.equal(lido?.meio, "boleto");
  assert.equal(lido?.motivo, null);
  assert.equal(lido?.pix_chave, null);
  assert.equal(lido?.conta, null);
});

test("o resumo do cadastro mostra o PIX, ou a conta quando não há PIX", () => {
  assert.equal(resumoDoCadastroDePagamento(cadastro), "PIX CNPJ · 11.222.333/0001-81");
  assert.equal(
    resumoDoCadastroDePagamento({ ...cadastro, pix_tipo: null, pix_chave: null }),
    "ITAÚ UNIBANCO · Ag. 1234 · CC 56789-0",
  );
  assert.equal(resumoDoCadastroDePagamento(null), null);
});

// Decisão 171: a verba do colaborador sai com a conta e o PIX que o banco
// copiou da ficha do RH, nas colunas da foto, e o CPF à parte.
const fotoDoColaborador = {
  verba_titular_tipo: "colaborador",
  verba_titular_cpf: "12345678909",
  dados_pagamento_congelados_em: "2026-10-14T10:00:00Z",
  ...tirarFoto({ ...cadastro, pix_tipo: "cpf", pix_chave: "12345678909" }),
};

test("a verba do colaborador imprime a conta, o PIX e o CPF da foto", () => {
  const pg = pagamentoDoTitularDaPP(fotoDoColaborador);
  assert.equal(pg?.conta, cadastro.conta);
  assert.equal(pg?.pix_chave, "12345678909");
  assert.equal(pg?.cpf, "12345678909");
});

test("sem conta nem PIX na ficha, a verba do colaborador sai sem o bloco", () => {
  assert.equal(pagamentoDoTitularDaPP({ ...fotoDoColaborador, ...tirarFoto(null) }), null);
});

test("terceiro e PP sem foto não têm pagamento do titular", () => {
  assert.equal(pagamentoDoTitularDaPP({ ...fotoDoColaborador, verba_titular_tipo: "fornecedor" }), null);
  assert.equal(pagamentoDoTitularDaPP({ ...fotoDoColaborador, dados_pagamento_congelados_em: null }), null);
});

// Decisão 193: o freela também leva o pagamento — o PIX do cadastro de
// freelas (pelo banco) ou o que foi digitado na PP.
test("a verba do freela imprime o pagamento da foto", () => {
  const pg = pagamentoDoTitularDaPP({ ...fotoDoColaborador, verba_titular_tipo: "freela" });
  assert.equal(pg?.pix_chave, "12345678909");
  assert.equal(pg?.cpf, "12345678909");
});

test("o PIX digitado vira a foto e volta para o formulário", () => {
  const pix = pagamentoDoTitularSchema.parse({ meio: "pix", pix_tipo: "telefone", pix_chave: "(71) 99999-0000" });
  assert.equal(pix.pix_chave, "+5571999990000");
  assert.equal(pix.conta, null);
  const foto = fotoDoPagamentoDoTitular(pix);
  assert.equal(foto.fornecedor_pix_tipo, "telefone");
  assert.equal(foto.fornecedor_conta, null);
  assert.deepEqual(pagamentoDoTitularDaFoto(foto), pix);
});

test("a conta digitada leva o nome do banco e o dígito em maiúscula", () => {
  const conta = pagamentoDoTitularSchema.parse({
    meio: "conta",
    banco_codigo: "077",
    agencia: "0001",
    conta: "9876543",
    conta_dv: "x",
    tipo_conta: "corrente",
  });
  assert.equal(conta.banco_nome, "Banco Inter S.A.");
  assert.equal(conta.conta_dv, "X");
  assert.equal(conta.pix_chave, null);
  assert.deepEqual(pagamentoDoTitularDaFoto(fotoDoPagamentoDoTitular(conta)), conta);
});

test("o pagamento do titular recusa o que o banco não aceita", () => {
  const semDigito = pagamentoDoTitularSchema.safeParse({
    meio: "conta",
    banco_codigo: "077",
    agencia: "0001",
    conta: "9876543",
    tipo_conta: "corrente",
  });
  assert.equal(semDigito.success, false);
  assert.match(semDigito.error?.issues[0]?.message ?? "", /dígito da conta/);
  const semTipo = pagamentoDoTitularSchema.safeParse({ meio: "pix", pix_chave: "71999990000" });
  assert.equal(semTipo.success, false);
  const cpfRuim = pagamentoDoTitularSchema.safeParse({ meio: "pix", pix_tipo: "cpf", pix_chave: "11111111112" });
  assert.equal(cpfRuim.success, false);
});
