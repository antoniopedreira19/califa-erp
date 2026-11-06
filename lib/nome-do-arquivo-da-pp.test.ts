/**
 * Testes do nome do arquivo da PP — decisão 241.
 *
 * Rode com:  node --import tsx --test lib/nome-do-arquivo-da-pp.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { nomeDoArquivoDaPP, quemVaiNoNomeDoArquivo } from "./nome-do-arquivo-da-pp";

test("número e fornecedor, separados por hífen", () => {
  assert.equal(nomeDoArquivoDaPP("PP-00613", "FORNECEDOR TESTE LTDA"), "PP-00613 - FORNECEDOR TESTE LTDA.pdf");
});

test("sem ninguém, ou com o vazio das telas, sai só o número", () => {
  assert.equal(nomeDoArquivoDaPP("PP-00613", null), "PP-00613.pdf");
  assert.equal(nomeDoArquivoDaPP("PP-00613", ""), "PP-00613.pdf");
  assert.equal(nomeDoArquivoDaPP("PP-00613", "—"), "PP-00613.pdf");
  assert.equal(nomeDoArquivoDaPP("PP-00613", "   "), "PP-00613.pdf");
});

test("tira o que o sistema de arquivos não aceita e os espaços repetidos", () => {
  assert.equal(nomeDoArquivoDaPP("PP-00001", "A/B: Produções  *Ltda*"), "PP-00001 - A B Produções Ltda.pdf");
  assert.equal(nomeDoArquivoDaPP("PP-00001", 'FORNECEDOR "TESTE" <LTDA>?'), "PP-00001 - FORNECEDOR TESTE LTDA.pdf");
});

test("nome muito longo é cortado em 80 caracteres", () => {
  const nome = nomeDoArquivoDaPP("PP-00001", "X".repeat(200));
  assert.equal(nome, `PP-00001 - ${"X".repeat(80)}.pdf`);
});

test("quem vai no nome: fornecedor, cartão ou quem recebe a verba", () => {
  assert.equal(quemVaiNoNomeDoArquivo({ fornecedor_nome: "FORNECEDOR TESTE LTDA" }), "FORNECEDOR TESTE LTDA");
  assert.equal(
    quemVaiNoNomeDoArquivo({ cartao_corporativo: true, cartao_plataforma: "Loja Exemplo", fornecedor_nome: null }),
    "Cartão corporativo — Loja Exemplo",
  );
  assert.equal(
    quemVaiNoNomeDoArquivo({
      verba_producao: true,
      tipo_verba: "alimentacao",
      verba_titular_nome: "COLABORADOR 001 EXEMPLO",
      fornecedor_nome: null,
    }),
    "COLABORADOR 001 EXEMPLO",
  );
  // A verba antiga (decisão 171): sem titular, o responsável.
  assert.equal(
    quemVaiNoNomeDoArquivo({ verba_producao: true, responsavel: { nome: "COLABORADOR 002 EXEMPLO" }, fornecedor_nome: null }),
    "COLABORADOR 002 EXEMPLO",
  );
});
