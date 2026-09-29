/**
 * Pagamento fora do cadastro (decisão 127): a foto troca SÓ o meio
 * escolhido, o asterisco da 067 ignora esse meio, e o schema grava a chave
 * no formato da remessa.
 *
 * Rodar: `npm run test:foto-pp`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aplicarPagamentoForaDoCadastro,
  cadastroMudouDepoisDaFoto,
  lerPagamentoForaDoCadastro,
  resumoDoCadastroDePagamento,
  tirarFoto,
  type DadosDePagamento,
} from "./foto-pagamento-da-pp";
import { pagamentoForaDoCadastroSchema } from "../validations/pagamento-fora-do-cadastro";

const cadastro: DadosDePagamento = {
  banco_codigo: "341",
  banco_nome: "ITAÚ UNIBANCO S.A.",
  agencia: "1234",
  agencia_dv: null,
  conta: "56789",
  conta_dv: "0",
  tipo_conta: "corrente",
  pix_tipo: "cnpj",
  pix_chave: "34567890000130",
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
  assert.equal(r.pix_chave, "34567890000130");
});

test("sem pagamento fora do cadastro, a foto é o cadastro", () => {
  const foto = tirarFoto(cadastro, null);
  assert.equal(foto.fornecedor_pix_chave, "34567890000130");
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

  const tel = pagamentoForaDoCadastroSchema.parse({
    meio: "pix",
    motivo: "Chave temporária do fornecedor",
    pix_tipo: "telefone",
    pix_chave: "11987654321",
  });
  assert.equal(tel.pix_chave, "+5511987654321");
});

test("o schema recusa motivo curto, chave torta e conta incompleta", () => {
  const curto = pagamentoForaDoCadastroSchema.safeParse({
    meio: "pix",
    motivo: "temp",
    pix_tipo: "cnpj",
    pix_chave: "34567890000130",
  });
  assert.equal(curto.success, false);

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

test("o resumo do cadastro mostra o PIX, ou a conta quando não há PIX", () => {
  assert.equal(resumoDoCadastroDePagamento(cadastro), "PIX CNPJ · 34.567.890/0001-30");
  assert.equal(
    resumoDoCadastroDePagamento({ ...cadastro, pix_tipo: null, pix_chave: null }),
    "ITAÚ UNIBANCO · Ag. 1234 · CC 56789-0",
  );
  assert.equal(resumoDoCadastroDePagamento(null), null);
});
