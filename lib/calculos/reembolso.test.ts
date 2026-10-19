/**
 * Testes do reembolso — decisão 187 (17/10/2026).
 *
 * Rode com:  node --import tsx --test lib/calculos/reembolso.test.ts
 *
 * Os casos de veículo próprio são as abas da planilha "Reembolso de
 * Gasolina" que o Tiago mandou (as duas primeiras abas): o combustível tem de bater
 * com o total que a planilha calculou. O desgaste sai da mesma lista de
 * trajetos — na planilha ele era digitado à parte e divergia.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contaDosDeslocamentos,
  faltaNosComprovantesDoReembolso,
  faltaNosDeslocamentos,
  resumoDosDeslocamentos,
  type DeslocamentosDoReembolso,
} from "./reembolso";

const linha = (km: number, vezes = 1, data = "2026-09-03") => ({ data, trajeto: "Agência → cliente → Agência", km_ida_volta: km, vezes });

test("a 1ª aba da planilha: o combustível bate com a planilha (R$ 152,08)", () => {
  const d: DeslocamentosDoReembolso = {
    consumo_km_l: 10,
    preco_litro: 7.09,
    desgaste_por_km: 0.4,
    linhas: [linha(55, 2), linha(40.1), linha(5.4), linha(29.5), linha(29.5)],
  };
  const c = contaDosDeslocamentos(d);
  assert.equal(Math.round(c.km * 10) / 10, 214.5);
  assert.equal(c.combustivel, 152.08); // H9 da planilha
  assert.equal(c.desgaste, 85.8); // 214,5 km × R$ 0,40 (a planilha digitou R$ 87,48)
  assert.equal(c.total, 237.88);
});

test("a 2ª aba da planilha: o combustível bate com a planilha (R$ 142,24)", () => {
  const d: DeslocamentosDoReembolso = {
    consumo_km_l: 8,
    preco_litro: 7.09,
    desgaste_por_km: 0.4,
    linhas: [22.6, 24.4, 22.6, 16.2, 4.2, 14.0, 19.4, 1.7, 3.0].map((k) => linha(k)).concat([linha(16.2, 2)]),
  };
  const c = contaDosDeslocamentos(d);
  assert.equal(c.combustivel, 142.24); // H14 da planilha
  assert.equal(c.desgaste, 64.2);
  assert.equal(c.total, 206.44);
});

test("o exemplo do protótipo: 104,5 km dão R$ 115,89", () => {
  const d: DeslocamentosDoReembolso = {
    consumo_km_l: 10,
    preco_litro: 7.09,
    desgaste_por_km: 0.4,
    linhas: [linha(40.1), linha(5.4), linha(29.5, 2)],
  };
  const c = contaDosDeslocamentos(d);
  assert.equal(c.combustivel, 74.09);
  assert.equal(c.desgaste, 41.8);
  assert.equal(c.total, 115.89);
  // O "R$" do toLocaleString vem com espaço não separável.
  assert.match(resumoDosDeslocamentos(d), /^3 deslocamentos · 104,5 km · combustível R\$\s74,09 \+ desgaste R\$\s41,80$/);
});

test("o desgaste segue o parâmetro do financeiro", () => {
  const d: DeslocamentosDoReembolso = { consumo_km_l: 10, preco_litro: 7, desgaste_por_km: 0.5, linhas: [linha(100)] };
  const c = contaDosDeslocamentos(d);
  assert.equal(c.combustivel, 70);
  assert.equal(c.desgaste, 50);
  assert.equal(c.total, 120);
});

test("o que falta nos deslocamentos", () => {
  const base: DeslocamentosDoReembolso = { consumo_km_l: 10, preco_litro: 7, desgaste_por_km: 0.4, linhas: [linha(10)] };
  assert.equal(faltaNosDeslocamentos(base), null);
  assert.match(faltaNosDeslocamentos({ ...base, consumo_km_l: 0 }) ?? "", /consumo/);
  assert.match(faltaNosDeslocamentos({ ...base, preco_litro: 0 }) ?? "", /preço do litro/);
  assert.match(faltaNosDeslocamentos({ ...base, linhas: [] }) ?? "", /pelo menos um/);
  assert.match(faltaNosDeslocamentos({ ...base, linhas: [linha(10), { ...linha(0), trajeto: "" }] }) ?? "", /2º deslocamento/);
  assert.match(faltaNosDeslocamentos({ ...base, linhas: [{ ...linha(10), data: "" }] }) ?? "", /1º deslocamento/);
});

test("comprovantes de despesas: tipo, número, data, valor e a soma", () => {
  const cupom = { tipo: "cupom_fiscal" as const, numero: "4471", data: "2026-10-15", valor: 186.4 };
  const recibo = { tipo: "recibo" as const, numero: "0212", data: "2026-10-15", valor: 92.5 };
  assert.equal(faltaNosComprovantesDoReembolso([cupom, recibo], 278.9, "despesas"), null);
  assert.match(faltaNosComprovantesDoReembolso([], 278.9, "despesas") ?? "", /Anexe os comprovantes/);
  assert.match(faltaNosComprovantesDoReembolso([{ ...cupom, tipo: null }], 186.4, "despesas") ?? "", /tipo/);
  assert.match(faltaNosComprovantesDoReembolso([{ ...cupom, tipo: "fatura" }], 186.4, "despesas") ?? "", /tipo/);
  assert.match(faltaNosComprovantesDoReembolso([{ ...cupom, numero: " " }], 186.4, "despesas") ?? "", /número/);
  assert.match(faltaNosComprovantesDoReembolso([{ ...cupom, data: "" }], 186.4, "despesas") ?? "", /data/);
  assert.match(faltaNosComprovantesDoReembolso([cupom], 278.9, "despesas") ?? "", /somam R\$\s186,40/);
});

test("anexos do veículo próprio: basta um arquivo, sem tipo", () => {
  const foto = { tipo: null, numero: null, data: null, valor: null };
  assert.equal(faltaNosComprovantesDoReembolso([foto], 115.89, "veiculo_proprio"), null);
  assert.match(faltaNosComprovantesDoReembolso([], 115.89, "veiculo_proprio") ?? "", /quilometragem/);
});
