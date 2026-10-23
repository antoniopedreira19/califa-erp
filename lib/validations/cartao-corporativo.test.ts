/**
 * Testes da plataforma e do link da PP no cartão corporativo (decisão 209,
 * 23/10/2026). Rodar: node --import tsx --test lib/validations/cartao-corporativo.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hrefDoLinkDaCompra,
  problemaDaPlataforma,
  problemaDoLinkDaCompra,
} from "./cartao-corporativo";

test("plataforma: vazia ou só espaço é falta", () => {
  assert.equal(problemaDaPlataforma(""), "Informe a plataforma.");
  assert.equal(problemaDaPlataforma("   "), "Informe a plataforma.");
  assert.equal(problemaDaPlataforma("Mercado Livre"), null);
  assert.match(problemaDaPlataforma("x".repeat(201)) ?? "", /mais de 200/);
});

test("link: endereço de site, com ou sem https", () => {
  assert.equal(problemaDoLinkDaCompra("loja.exemplo.com/pedido/123"), null);
  assert.equal(problemaDoLinkDaCompra("https://loja.exemplo.com"), null);
  assert.equal(problemaDoLinkDaCompra("  http://exemplo.com.br/a?b=1  "), null);
});

test("link: vazio, sem ponto ou com espaço é recusado", () => {
  assert.equal(problemaDoLinkDaCompra(""), "Cole o link da compra.");
  assert.equal(problemaDoLinkDaCompra("pagar no site"), "Isso não parece um link: confira o endereço.");
  assert.equal(problemaDoLinkDaCompra("mercadolivre"), "Isso não parece um link: confira o endereço.");
});

test("href: sem esquema ganha https, e nenhum outro esquema chega ao link", () => {
  assert.equal(hrefDoLinkDaCompra("loja.exemplo.com/p"), "https://loja.exemplo.com/p");
  assert.equal(hrefDoLinkDaCompra("https://loja.exemplo.com"), "https://loja.exemplo.com");
  assert.equal(hrefDoLinkDaCompra("HTTP://loja.exemplo.com"), "HTTP://loja.exemplo.com");
  // Passa na régua (tem ponto) mas não pode virar `javascript:` no href.
  assert.equal(hrefDoLinkDaCompra("javascript:alert(1).x"), "https://javascript:alert(1).x");
});
