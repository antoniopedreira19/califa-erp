import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validarCnpj,
  validarDataEmissao,
  validarValor,
  validarNumeroNF,
  validarDescricao,
} from "./validacoes-nf";

test("validarCnpj — null para entrada vazia", () => {
  assert.equal(validarCnpj(null), null);
  assert.equal(validarCnpj(""), null);
  assert.equal(validarCnpj("   "), null);
});

test("validarCnpj — null para número de dígitos errado", () => {
  assert.equal(validarCnpj("1943797600015"), null); // 13 dígitos
  assert.equal(validarCnpj("194379760001544"), null); // 15 dígitos
});

test("validarCnpj — null para dígitos repetidos", () => {
  assert.equal(validarCnpj("00000000000000"), null);
  assert.equal(validarCnpj("99999999999999"), null);
  assert.equal(validarCnpj("11111111111111"), null);
});

test("validarCnpj — null para DV inválido", () => {
  assert.equal(validarCnpj("19437976000199"), null); // DV errado
});

test("validarCnpj — aceita formatado e devolve só dígitos", () => {
  assert.equal(validarCnpj("19.437.976/0001-54"), "19437976000154");
});

test("validarCnpj — aceita sem formatação", () => {
  assert.equal(validarCnpj("19437976000154"), "19437976000154");
});

test("validarDataEmissao — null para entrada vazia ou inválida", () => {
  assert.equal(validarDataEmissao(null, "2026-10-08"), null);
  assert.equal(validarDataEmissao("", "2026-10-08"), null);
  assert.equal(validarDataEmissao("abacaxi", "2026-10-08"), null);
  assert.equal(validarDataEmissao("2026-13-01", "2026-10-08"), null); // mês inválido
});

test("validarDataEmissao — null se data futura", () => {
  assert.equal(validarDataEmissao("2027-01-01", "2026-10-08"), null);
});

test("validarDataEmissao — null se antes de 2015", () => {
  assert.equal(validarDataEmissao("2014-12-31", "2026-10-08"), null);
});

test("validarDataEmissao — aceita data válida no intervalo", () => {
  assert.equal(validarDataEmissao("2026-10-01", "2026-10-08"), "2026-10-01");
  assert.equal(validarDataEmissao("2015-01-01", "2026-10-08"), "2015-01-01");
  assert.equal(validarDataEmissao("2026-10-08", "2026-10-08"), "2026-10-08");
});

test("validarValor — null para zero, negativo ou acima de 10M", () => {
  assert.equal(validarValor(null), null);
  assert.equal(validarValor(0), null);
  assert.equal(validarValor(-100), null);
  assert.equal(validarValor(10_000_001), null);
});

test("validarValor — aceita valor no intervalo", () => {
  assert.equal(validarValor(0.01), 0.01);
  assert.equal(validarValor(5000), 5000);
  assert.equal(validarValor(9_999_999.99), 9_999_999.99);
});

test("validarNumeroNF — null se vazio", () => {
  assert.equal(validarNumeroNF(null), null);
  assert.equal(validarNumeroNF(""), null);
  assert.equal(validarNumeroNF("   "), null);
});

test("validarNumeroNF — trim e retorna", () => {
  assert.equal(validarNumeroNF("  00012345  "), "00012345");
});

test("validarDescricao — null se vazia; corta em 500", () => {
  assert.equal(validarDescricao(null), null);
  assert.equal(validarDescricao(""), null);
  assert.equal(validarDescricao("Produção audiovisual"), "Produção audiovisual");
  assert.equal(validarDescricao("x".repeat(600))?.length, 500);
});
